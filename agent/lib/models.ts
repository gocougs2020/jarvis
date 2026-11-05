import { generateText, Output, type ModelMessage } from "ai";
import type { AgentModelOptionsDefinition } from "eve";
import { defineState } from "eve/context";
import { z } from "zod";
import { appConfig } from "../../app.config";
import { recordGenerateTextUsage } from "../../lib/record-usage";
import { resolveChatForEveSession } from "../../lib/session-memory";
import { getUserSettings } from "../../lib/store";
import { turnContextWindowTokens } from "../../lib/token-budget";

export const FAST_MODEL = appConfig.models.chatFast;
export const LOW_MODEL = appConfig.models.chatLow;
export const HIGH_MODEL = appConfig.models.chatHigh;
export const COMPACTION_MODEL = appConfig.models.compaction;

/** Locked after the first prompt of a session so later turns reuse the same model cache. */
export type SessionChatRoute = "fast" | "reason" | "complex";

const sessionChatRoute = defineState("agent.session-chat-route", () => null as SessionChatRoute | null);

const routeSchema = z.object({
  route: z.enum(["fast", "reason", "complex"]),
});

const ASSESS_PROMPT_LIMIT = 2_000;

const ASSESS_SYSTEM = [
  "Classify a user prompt for chat-model routing. Reply with one route only.",
  "fast — greetings, simple facts, formatting, rewrites, yes/no, or anything a capable fast model can answer well without analysis, live data, or extra thinking.",
  "reason — analysis, comparison, planning, real-world or current events/data, or thinking would make the answer more accurate, thorough, or relevant. Default here when thinking would help.",
  "complex — unusually hard work: deep research, large multi-part proposals, many interdependent constraints, or a query that needs the strongest model.",
  "Prefer fast when thinking is unlikely to improve the answer. Use complex only when the query is clearly very complex.",
].join(" ");

/**
 * Provider options that turn on deeper reasoning for the "reason" and
 * "complex" routes. eve's dynamic model selection only forwards
 * providerOptions, so each provider's own knob is listed here. A provider
 * that is not listed runs with its default reasoning, so swapping
 * `models.chatLow` / `chatHigh` in app.config.ts never breaks a turn.
 */
export function highReasoningProviderOptions(
  modelId: string,
): AgentModelOptionsDefinition["providerOptions"] {
  const provider = modelId.split("/")[0]?.toLowerCase();
  switch (provider) {
    case "openai":
      return { openai: { reasoningEffort: "high" } };
    case "anthropic":
      return { anthropic: { thinking: { type: "enabled", budgetTokens: 16_000 } } };
    case "xai":
    case "spacexai":
      return { xai: { reasoningEffort: "high" } };
    default:
      return undefined;
  }
}

export function modelSelection(modelId: string, route: SessionChatRoute = "fast") {
  const providerOptions = route === "fast" ? undefined : highReasoningProviderOptions(modelId);
  return {
    model: modelId,
    modelContextWindowTokens: turnContextWindowTokens(modelId),
    ...(providerOptions ? { modelOptions: { providerOptions } } : {}),
  };
}

export function modelSelectionForRoute(route: SessionChatRoute) {
  if (route === "complex") return modelSelection(HIGH_MODEL, route);
  if (route === "reason") return modelSelection(LOW_MODEL, route);
  return modelSelection(FAST_MODEL, route);
}

export async function settingsForPrincipal(principalId: string | undefined) {
  if (!principalId) {
    return { modelTier: "auto" as const, instructionOverlay: "" };
  }
  return getUserSettings(principalId);
}

export function latestUserText(messages: readonly ModelMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((part) => part.type === "text")
              .map((part) => ("text" in part ? part.text : ""))
              .join("\n")
          : "";
    if (text.trim()) return text;
  }
  return "";
}

/**
 * A first prompt this short ("hi", "thanks", "what's 2+2") goes to the fast
 * model without a routing call, which saves a model round trip before the
 * first token.
 */
export function isTrivialPrompt(text: string): boolean {
  const prompt = text.trim();
  return prompt.length > 0 && prompt.length < 16 && prompt.split(/\s+/).length <= 3;
}

export async function assessPromptRoute(
  text: string,
  attribution?: Promise<{ readonly chatId?: string | null; readonly userId?: string }>,
): Promise<SessionChatRoute> {
  const prompt = text.trim().slice(0, ASSESS_PROMPT_LIMIT);
  if (!prompt) return "fast";
  if (isTrivialPrompt(prompt)) return "fast";

  try {
    const result = await generateText({
      maxOutputTokens: 40,
      model: FAST_MODEL,
      output: Output.object({ schema: routeSchema }),
      prompt,
      reasoning: "none",
      system: ASSESS_SYSTEM,
      timeout: 4_000,
    });
    void (attribution ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then((owner) => recordGenerateTextUsage("routing", FAST_MODEL, result, owner));
    return result.output.route;
  } catch (error) {
    console.error("[session-model] route assessment failed; using chatLow with reasoning", error);
    return "reason";
  }
}

/**
 * Classify the first user prompt once, then reuse that model for the session.
 * An empty first snapshot (no user text yet) is not locked so the first turn can assess.
 */
export async function resolveSessionModelSelection(
  messages: readonly ModelMessage[],
  attribution?: { readonly eveSessionId?: string; readonly userId?: string; readonly chatId?: string },
) {
  const locked = sessionChatRoute.get();
  if (locked) return modelSelectionForRoute(locked);

  const text = latestUserText(messages);
  if (!text.trim()) return modelSelectionForRoute("fast");

  const userId = attribution?.userId;
  // The chat lookup is only for usage attribution, so it runs alongside the
  // routing call instead of in front of it.
  const owner =
    userId && attribution.eveSessionId
      ? resolveChatForEveSession(userId, attribution.eveSessionId, attribution.chatId).then(
          (chat) => ({ chatId: chat?.id ?? attribution.chatId, userId }),
          // Attribution is best-effort; never leave this rejection unhandled.
          () => ({ chatId: attribution.chatId, userId }),
        )
      : userId
        ? Promise.resolve({ chatId: attribution.chatId, userId })
        : undefined;
  const route = await assessPromptRoute(text, owner);
  sessionChatRoute.update(() => route);
  return modelSelectionForRoute(route);
}
