/**
 * Storage compaction for eve stream events.
 *
 * eve streams one event per token. Each `message.appended` and
 * `reasoning.appended` event also carries the whole text so far, so storing
 * them one row each grows quadratically with the reply length (a single long
 * answer was thousands of rows and megabytes). The client reducer only reads
 * `messageSoFar` / `reasoningSoFar` from those events, and appends
 * `action.input.appended` deltas by offset, so a run of deltas collapses to one
 * event without changing what the transcript replays to.
 */

type StreamEventLike = {
  readonly type: string;
  readonly data?: unknown;
  readonly meta?: unknown;
};

type TextDeltaData = {
  turnId?: unknown;
  stepIndex?: unknown;
  sequence?: unknown;
  messageDelta?: unknown;
  reasoningDelta?: unknown;
};

type ToolInputDeltaData = {
  callId?: unknown;
  inputTextDelta?: unknown;
  inputTextOffset?: unknown;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sameTextRun(previous: StreamEventLike, next: StreamEventLike): boolean {
  if (previous.type !== next.type) return false;
  const a = record(previous.data) as TextDeltaData | undefined;
  const b = record(next.data) as TextDeltaData | undefined;
  if (!a || !b) return false;
  return a.turnId === b.turnId && a.stepIndex === b.stepIndex && a.sequence === b.sequence;
}

function mergeTextRun<T extends StreamEventLike>(previous: T, next: T): T {
  const deltaKey = next.type === "message.appended" ? "messageDelta" : "reasoningDelta";
  const a = record(previous.data) ?? {};
  const b = record(next.data) ?? {};
  const delta = `${typeof a[deltaKey] === "string" ? a[deltaKey] : ""}${
    typeof b[deltaKey] === "string" ? b[deltaKey] : ""
  }`;
  return { ...next, data: { ...b, [deltaKey]: delta } };
}

function mergeToolInput<T extends StreamEventLike>(previous: T, next: T): T | undefined {
  if (previous.type !== next.type) return undefined;
  const a = record(previous.data) as ToolInputDeltaData | undefined;
  const b = record(next.data) as ToolInputDeltaData | undefined;
  if (!a || !b || a.callId !== b.callId) return undefined;
  if (
    typeof a.inputTextDelta !== "string" ||
    typeof b.inputTextDelta !== "string" ||
    typeof a.inputTextOffset !== "number" ||
    typeof b.inputTextOffset !== "number"
  ) {
    return undefined;
  }
  // Only merge contiguous deltas, so replay through the offset check still holds.
  if (a.inputTextOffset + a.inputTextDelta.length !== b.inputTextOffset) return undefined;
  return {
    ...next,
    data: {
      ...(record(next.data) ?? {}),
      inputTextDelta: a.inputTextDelta + b.inputTextDelta,
      inputTextOffset: a.inputTextOffset,
    },
  };
}

/** Collapse runs of streaming delta events. Every other event is kept as is, in order. */
export function compactStreamEvents<T extends StreamEventLike>(events: readonly T[]): T[] {
  const out: T[] = [];
  for (const event of events) {
    const previous = out.at(-1);
    if (previous) {
      if (
        (event.type === "message.appended" || event.type === "reasoning.appended") &&
        sameTextRun(previous, event)
      ) {
        out[out.length - 1] = mergeTextRun(previous, event);
        continue;
      }
      if (event.type === "action.input.appended") {
        const merged = mergeToolInput(previous, event);
        if (merged) {
          out[out.length - 1] = merged;
          continue;
        }
      }
    }
    out.push(event);
  }
  return out;
}

/**
 * First index where `next` differs from what was already stored. Rows before
 * it are unchanged, so a checkpoint only needs to write `next.slice(index)`.
 */
export function firstChangedIndex<T>(
  stored: readonly T[],
  next: readonly T[],
  same: (left: T, right: T) => boolean,
): number {
  const limit = Math.min(stored.length, next.length);
  for (let index = 0; index < limit; index += 1) {
    if (!same(stored[index] as T, next[index] as T)) return index;
  }
  return limit;
}
