import { generateText, Output } from "ai";
import { outputTokenBudget } from "@/lib/reasoning";
import { z } from "zod";
import { appConfig } from "@/app.config";
import { recordGenerateTextUsage } from "@/lib/record-usage";
import { titleFromPrompt } from "@/lib/store-logic";

const titleModel = appConfig.models.sessionTitle;
const titleReasoning = appConfig.models.reasoning.sessionTitle;
const sessionSummarySchema = z.object({
  title: z.string(),
  description: z.string(),
});
const maxTitleLength = 96;
const maxDescriptionLength = 480;
const recentTurnLimit = 6;
const placeholderTitle = "New session";

function recentSessionTurns(
  messages: readonly (string | undefined)[] = [],
  prompt?: string,
): string[] {
  const uniqueTurns = [
    ...new Set(
      [...messages, prompt]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (uniqueTurns.length <= recentTurnLimit) return uniqueTurns;
  const [first] = uniqueTurns;
  const recent = uniqueTurns.slice(-(recentTurnLimit - 1));
  return recent.includes(first) ? uniqueTurns.slice(-recentTurnLimit) : [first, ...recent];
}

export function sanitizeSessionTitle(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return fallback;
  return cleaned.length > maxTitleLength ? `${cleaned.slice(0, maxTitleLength - 1).trimEnd()}…` : cleaned;
}

export function sanitizeSessionDescription(value: string, fallback = ""): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return fallback;
  return cleaned.length > maxDescriptionLength
    ? `${cleaned.slice(0, maxDescriptionLength - 1).trimEnd()}…`
    : cleaned;
}

export async function generateSessionSummary({
  currentDescription,
  currentTitle,
  messages,
  prompt,
}: {
  currentDescription?: string;
  currentTitle?: string;
  messages?: readonly string[];
  prompt?: string;
}): Promise<{ description: string; title: string }> {
  const uniqueTurns = recentSessionTurns(messages, prompt);
  const establishedTitle = currentTitle?.trim();
  const fallbackTitle =
    establishedTitle && establishedTitle !== placeholderTitle
      ? sanitizeSessionTitle(establishedTitle, placeholderTitle)
      : titleFromPrompt(uniqueTurns[0] || establishedTitle || placeholderTitle);
  const fallbackDescription = currentDescription?.trim() ?? "";

  if (uniqueTurns.length === 0) {
    return { description: fallbackDescription, title: fallbackTitle };
  }

  try {
    const result = await generateText({
      maxOutputTokens: outputTokenBudget(titleReasoning, 220),
      model: titleModel,
      output: Output.object({ schema: sessionSummarySchema }),
      prompt: [
        establishedTitle && establishedTitle !== placeholderTitle
          ? `Established title: ${establishedTitle}`
          : "Established title: (none)",
        fallbackDescription
          ? `Established description: ${fallbackDescription}`
          : "Established description: (none)",
        uniqueTurns.length === 1
          ? "Latest user message:"
          : "User messages (first is how the session started; later items may include a recent tangent):",
        ...uniqueTurns.map((turn, index) => `${index + 1}. ${turn.slice(0, 280)}`),
      ].join("\n"),
      reasoning: titleReasoning,
      system:
        "Update the recents-list title and description for an ongoing session. When an established title or description is provided, treat them as the session identity and summarize from those plus the new messages — never from the latest turn alone. Prefer how the session started. You may polish a truncated or awkward title, or refine the wording when new messages continue the same work. Do not retitle around a later side question, follow-up, or unrelated ask; keep the existing title in that case and only extend the description if the new content is part of the same work. Title: 6 to 14 words, no quotes, no prefix, no trailing punctuation, never cut off mid-phrase. Description: 1 to 3 sentences about the session as a whole.",
    });
    void recordGenerateTextUsage("session_title", titleModel, result);
    return {
      title: sanitizeSessionTitle(result.output.title, fallbackTitle),
      description: sanitizeSessionDescription(result.output.description, fallbackDescription),
    };
  } catch (error) {
    console.error("[session-title] generate failed", error);
    return { description: fallbackDescription, title: fallbackTitle };
  }
}
