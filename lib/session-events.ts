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

export function isInactiveSessionError(message: string): boolean {
  return /no longer active|no_active_session|unknown or terminal/i.test(message);
}

/**
 * The root session for `sessionId` when it is a delegated child named by a
 * `subagent.called` event in this chat's log, else `sessionId` unchanged.
 * Repairs chats saved while a child session could overwrite the chat's link
 * (reloading such a chat resumed the child's transcript instead of the chat).
 */
export function rootSessionIdFromEvents(
  sessionId: string,
  events: readonly { readonly type: string; readonly data?: unknown }[],
): string {
  const parentOf = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "subagent.called") continue;
    const data = event.data as { childSessionId?: unknown; sessionId?: unknown } | undefined;
    if (typeof data?.childSessionId === "string" && typeof data.sessionId === "string") {
      parentOf.set(data.childSessionId, data.sessionId);
    }
  }
  let current = sessionId;
  const seen = new Set<string>();
  while (parentOf.has(current) && !seen.has(current)) {
    seen.add(current);
    current = parentOf.get(current) as string;
  }
  return current;
}
