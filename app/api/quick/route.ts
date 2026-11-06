import { streamText } from "ai";
import { NextResponse } from "next/server";
import { appConfig } from "@/app.config";
import { requireApiSession } from "@/lib/api";
import { APP_NAME } from "@/lib/brand";
import { listProfileMemories } from "@/lib/profile-memory";
import {
  parseQuickDecision,
  quickHistoryMessages,
  quickReplySystemPrompt,
  type QuickDecision,
  type QuickHistoryTurn,
} from "@/lib/quick-reply";
import { signQuickRouteHint } from "@/lib/quick-route-hint";
import type { QuickStreamEvent } from "@/lib/quick-reply-client";
import { outputTokenBudget } from "@/lib/reasoning";
import { recordGenerateTextUsage } from "@/lib/record-usage";
import { getChat, getUserSettings } from "@/lib/store";

export const runtime = "nodejs";

const MODEL = appConfig.models.quickReply;
const EFFORT = appConfig.models.reasoning.quickReply;
const MAX_PROMPT_CHARS = 4_000;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 4_000;
/** The hand-off line is one sentence; stop the model once it is written. */
const MAX_ACK_CHARS = 240;

type QuickRequestBody = {
  prompt?: unknown;
  history?: unknown;
  timeZone?: unknown;
  locale?: unknown;
  chatId?: unknown;
};

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readHistory(value: unknown): QuickHistoryTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => {
      const row = (turn ?? {}) as { prompt?: unknown; reply?: unknown };
      return { prompt: text(row.prompt, MAX_HISTORY_CHARS), reply: text(row.reply, MAX_HISTORY_CHARS) };
    })
    .filter((turn) => turn.prompt && turn.reply);
}

function line(event: QuickStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

/**
 * Instant first reply. Streams NDJSON: one `decision` event (answer here, or
 * hand off to the agent with a signed route hint), then `text` deltas, then
 * `done`. Any failure before the decision is an `error`, and the client
 * starts the agent as it would have without this layer.
 */
export async function POST(request: Request) {
  if (!appConfig.quickReply.enabled) {
    return NextResponse.json({ error: "Quick replies are off." }, { status: 404 });
  }
  const { session, error } = await requireApiSession(request);
  if (error || !session) return error;

  const body = (await request.json().catch(() => ({}))) as QuickRequestBody;
  const prompt = text(body.prompt, MAX_PROMPT_CHARS + 1);
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    return NextResponse.json({ error: "Prompt is empty or too long." }, { status: 400 });
  }
  const userId = session.user.id;
  const chatId = text(body.chatId, 200) || null;

  const [settings, memories] = await Promise.all([
    getUserSettings(userId).catch(() => null),
    listProfileMemories(userId).catch(() => []),
  ]);
  const system = quickReplySystemPrompt({
    appName: APP_NAME,
    now: new Date(),
    timeZone: text(body.timeZone, 64) || undefined,
    locale: text(body.locale, 35) || undefined,
    userName: session.user.name,
    instructionOverlay: settings?.instructionOverlay,
    profileMemory: memories.map((entry) => `- ${entry.text}`).join("\n"),
  });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const result = streamText({
    abortSignal: abort.signal,
    maxOutputTokens: outputTokenBudget(EFFORT, appConfig.quickReply.maxAnswerTokens),
    messages: [...quickHistoryMessages(readHistory(body.history)), { role: "user", content: prompt }],
    model: MODEL,
    reasoning: EFFORT,
    system,
  });

  void Promise.resolve(result.totalUsage)
    .then(async (usage) => {
      const owned = chatId ? await getChat(userId, chatId).catch(() => null) : null;
      await recordGenerateTextUsage("quick_reply", MODEL, { totalUsage: usage }, {
        chatId: owned?.id ?? null,
        userId,
      });
    })
    .catch(() => undefined);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let decision: QuickDecision | undefined;
      let ack = "";

      const decide = (next: QuickDecision) => {
        decision = next;
        controller.enqueue(
          line(
            next.mode === "agent"
              ? { type: "decision", mode: "agent", route: next.route, hint: signQuickRouteHint(userId, next.route) }
              : { type: "decision", mode: "answer" },
          ),
        );
      };

      /** Returns false once the hand-off sentence is complete. */
      const emit = (delta: string): boolean => {
        if (!delta) return true;
        if (decision?.mode !== "agent") {
          controller.enqueue(line({ type: "text", delta }));
          return true;
        }
        const room = MAX_ACK_CHARS - ack.length;
        const newline = delta.indexOf("\n");
        const piece = delta.slice(0, Math.min(room, newline < 0 ? delta.length : newline));
        if (piece) {
          ack += piece;
          controller.enqueue(line({ type: "text", delta: piece }));
        }
        return newline < 0 && ack.length < MAX_ACK_CHARS;
      };

      try {
        for await (const delta of result.textStream) {
          if (decision) {
            if (!emit(delta)) break;
            continue;
          }
          buffer += delta;
          const parsed = parseQuickDecision(buffer);
          if (parsed.status === "pending") continue;
          if (parsed.status === "invalid") {
            decide({ mode: "agent", route: "reason" });
            break;
          }
          decide(parsed.decision);
          if (!emit(parsed.rest)) break;
        }
        if (!decision) {
          // The model stopped before a newline: a bare "AGENT reason" is still a decision.
          const parsed = parseQuickDecision(`${buffer}\n`);
          decide(
            parsed.status === "decided" && parsed.decision.mode === "agent"
              ? parsed.decision
              : { mode: "agent", route: "reason" },
          );
        }
        controller.enqueue(line({ type: "done" }));
      } catch (streamError) {
        if (!abort.signal.aborted) console.error("[quick-reply] stream failed", streamError);
        controller.enqueue(line({ type: "error" }));
      } finally {
        abort.abort();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/x-ndjson; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
