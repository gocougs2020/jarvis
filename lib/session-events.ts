import type { LanguageModelUsage } from "ai";
import { isCurrentTurnBoundaryEvent, type MessageStreamEvent } from "eve/client";
import { collectStepUsageFromEvents, languageModelUsageFromTokens, totalsFromSteps } from "@/lib/usage";
import { turnContextWindowTokens } from "./token-budget";

export type SessionContextUsage = {
  readonly compactionCount: number;
  readonly lastCompactionInputTokens: number | null;
  readonly maxTokens: number;
  readonly modelId: string;
  readonly sessionCostUsd: number;
  readonly stepCount: number;
  readonly usage: LanguageModelUsage;
  readonly usedTokens: number;
};

export function sessionContextUsage(
  events: readonly MessageStreamEvent[],
): SessionContextUsage | undefined {
  const collected = collectStepUsageFromEvents(events);
  const lastStep = collected.lastStep;
  const modelId = collected.lastChatModelId ?? lastStep?.modelId;
  if (!modelId || !lastStep) return undefined;

  const sessionTotals = totalsFromSteps(collected.steps);

  return {
    compactionCount: collected.compactionCount,
    lastCompactionInputTokens: collected.lastCompactionInputTokens,
    maxTokens: turnContextWindowTokens(modelId),
    modelId,
    sessionCostUsd: sessionTotals.costUsd,
    stepCount: collected.steps.length,
    usedTokens: lastStep.inputTokens,
    usage: languageModelUsageFromTokens(sessionTotals),
  };
}

export function hasSettledSessionTail(events: readonly MessageStreamEvent[]): boolean {
  const last = events.at(-1);
  return last !== undefined && isCurrentTurnBoundaryEvent(last);
}

export function shouldResumeEveSession(
  sessionId: string | null | undefined,
  events: readonly MessageStreamEvent[] = [],
): boolean {
  return Boolean(sessionId) && !hasSettledSessionTail(events);
}

export function hasTerminalSessionTail(events: readonly MessageStreamEvent[]): boolean {
  const last = events.at(-1);
  return last?.type === "session.failed" || last?.type === "session.completed";
}

/**
 * A chat whose saved log ends on a settled turn does not resume on load, so a
 * turn sent into its session from the server (an emailed reply) would never
 * show. Such a chat checks the durable stream past its saved cursor instead.
 */
export function shouldProbeForServerTurns(
  sessionId: string | null | undefined,
  events: readonly MessageStreamEvent[] = [],
): boolean {
  return Boolean(sessionId) && hasSettledSessionTail(events) && !hasTerminalSessionTail(events);
}

/** The slice of the eve client the stream probe uses. */
export type SessionStreamProbeClient = {
  readonly sessions: {
    attach(
      sessionId: string,
      options: { readonly streamIndex: number },
    ): {
      stream(options: { readonly follow: false; readonly signal?: AbortSignal }): AsyncIterable<unknown>;
    };
  };
};

/**
 * True when the session's durable stream holds events at or after
 * `streamIndex`, the cursor this page last consumed. A bounded read
 * (`follow: false`) that stops at the first event, so it costs one short
 * request. Any failure reads as "nothing new".
 */
export async function hasUnseenSessionEvents(
  client: SessionStreamProbeClient,
  sessionId: string,
  streamIndex: number,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const stream = client.sessions
      .attach(sessionId, { streamIndex: Math.max(0, streamIndex) })
      .stream({ follow: false, signal });
    for await (const event of stream) {
      if (event !== undefined) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isInactiveSessionError(message: string): boolean {
  return /no longer active|no_active_session|unknown or terminal/i.test(message);
}

/** Visible assistant text from the most recent turn, for reading the reply aloud. */
export function latestTurnReplyText(events: readonly MessageStreamEvent[]): string {
  let turnId: string | undefined;
  const parts: string[] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "message.completed") continue;
    if (turnId === undefined) turnId = event.data.turnId;
    if (event.data.turnId !== turnId) break;
    if (event.data.message?.trim()) parts.unshift(event.data.message.trim());
  }
  return parts.join("\n\n");
}
