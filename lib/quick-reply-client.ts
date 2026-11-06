import type { MessageStreamEvent } from "eve/client";
import type { QuickHistoryTurn } from "./quick-reply";
import type { QuickRoute } from "./quick-route";

/** NDJSON lines from `POST /api/quick`. */
export type QuickStreamEvent =
  | { readonly type: "decision"; readonly mode: "answer" }
  | {
      readonly type: "decision";
      readonly mode: "agent";
      readonly route: QuickRoute;
      /** Signed route for the agent's first turn; null when the server has no auth secret. */
      readonly hint: string | null;
    }
  | { readonly type: "text"; readonly delta: string }
  | { readonly type: "done" }
  | { readonly type: "error" };

export type QuickDecisionEvent = Extract<QuickStreamEvent, { type: "decision" }>;

/** Quick turns use this turn-id prefix so they never collide with agent turns. */
export const QUICK_TURN_PREFIX = "quick_";

export function newQuickTurnId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${QUICK_TURN_PREFIX}${random}`;
}

function eventTurnId(event: MessageStreamEvent): string | undefined {
  const data = (event as { data?: { turnId?: unknown } }).data;
  return typeof data?.turnId === "string" ? data.turnId : undefined;
}

export function isQuickEvent(event: MessageStreamEvent): boolean {
  return eventTurnId(event)?.startsWith(QUICK_TURN_PREFIX) ?? false;
}

/** True once an agent session has written anything to this chat's log. */
export function hasAgentEvents(events: readonly MessageStreamEvent[]): boolean {
  return events.some((event) => !isQuickEvent(event));
}

/**
 * Stored stream events for one quick answer, in the shape eve's message
 * reducer renders. The chat's saved log replays them like any agent turn.
 */
export function quickTurnEvents(
  turnId: string,
  prompt: string,
  reply: string,
  now = new Date(),
): MessageStreamEvent[] {
  const at = now.toISOString();
  const stamp = <T extends object>(index: number, event: T) => ({
    ...event,
    meta: { at, id: `${turnId}:${index}` },
  });
  return [
    stamp(0, { type: "turn.started", data: { sequence: 0, turnId } }),
    stamp(1, {
      type: "message.received",
      data: { message: prompt, parts: [{ type: "text", text: prompt }], sequence: 1, turnId },
    }),
    stamp(2, {
      type: "message.completed",
      data: { finishReason: "stop", message: reply, sequence: 2, stepIndex: 0, turnId },
    }),
    stamp(3, { type: "turn.completed", data: { sequence: 3, turnId } }),
  ] as MessageStreamEvent[];
}

/** Quick answers saved in a chat log, oldest first. */
export function quickHistoryFromEvents(events: readonly MessageStreamEvent[]): QuickHistoryTurn[] {
  const turns = new Map<string, { prompt: string; reply: string }>();
  for (const event of events) {
    if (!isQuickEvent(event)) continue;
    const turnId = eventTurnId(event) as string;
    const turn = turns.get(turnId) ?? { prompt: "", reply: "" };
    if (event.type === "message.received") turn.prompt = event.data.message;
    if (event.type === "message.completed") turn.reply = event.data.message ?? "";
    turns.set(turnId, turn);
  }
  return [...turns.values()].filter((turn) => turn.prompt && turn.reply);
}

/**
 * The agent never saw quick answers. Its first turn in such a chat gets them
 * as client context, so a follow-up like "make that a table" still works.
 */
export function quickHandoffContext(history: readonly QuickHistoryTurn[]): string | undefined {
  if (history.length === 0) return undefined;
  const transcript = history
    .map((turn) => `User: ${turn.prompt}\nAssistant: ${turn.reply}`)
    .join("\n\n");
  return `Earlier in this conversation, before you joined, the user got these quick replies. Treat them as prior turns of this chat:\n\n${transcript}`;
}

/** First token of a skill mention ("/plan …") means the agent should load that skill. */
export function startsWithSkillMention(text: string): boolean {
  return /^\/[a-z0-9]/i.test(text.trim());
}

type QuickStreamHandlers = {
  readonly onDecision: (decision: QuickDecisionEvent) => void;
  readonly onText: (delta: string) => void;
};

/**
 * Read the quick-reply stream. Resolves `"done"` when the stream finished
 * cleanly and `"failed"` on any error; `onDecision` fires at most once.
 */
export async function readQuickReply(
  input: {
    readonly prompt: string;
    readonly chatId?: string;
    readonly history?: readonly QuickHistoryTurn[];
    readonly signal?: AbortSignal;
  },
  handlers: QuickStreamHandlers,
): Promise<"done" | "failed"> {
  let decided = false;
  try {
    const locale = typeof navigator === "undefined" ? undefined : navigator.language;
    const response = await fetch("/api/quick", {
      body: JSON.stringify({
        chatId: input.chatId,
        history: input.history ?? [],
        locale,
        prompt: input.prompt,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: input.signal,
    });
    if (!response.ok || !response.body) return "failed";
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return "failed";
      pending += value;
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const raw = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
        if (!raw) continue;
        const event = JSON.parse(raw) as QuickStreamEvent;
        if (event.type === "decision" && !decided) {
          decided = true;
          handlers.onDecision(event);
        } else if (event.type === "text" && decided) {
          handlers.onText(event.delta);
        } else if (event.type === "done") {
          await reader.cancel().catch(() => undefined);
          return decided ? "done" : "failed";
        } else if (event.type === "error") {
          await reader.cancel().catch(() => undefined);
          return "failed";
        }
      }
    }
  } catch {
    return "failed";
  }
}
