import { describe, expect, it } from "vitest";
import { compactStreamEvents, firstChangedIndex } from "@/lib/chat-event-compaction";

const text = (type: "message.appended" | "reasoning.appended", delta: string, soFar: string, id: string, stepIndex = 0) => {
  const key = type === "message.appended" ? "message" : "reasoning";
  return {
    type,
    data: { turnId: "turn_0", sequence: 0, stepIndex, [`${key}Delta`]: delta, [`${key}SoFar`]: soFar },
    meta: { id },
  };
};

describe("compactStreamEvents", () => {
  it("collapses a run of text deltas into its final state", () => {
    const events = [
      { type: "turn.started", data: { turnId: "turn_0" }, meta: { id: "a" } },
      text("message.appended", "Hel", "Hel", "b"),
      text("message.appended", "lo", "Hello", "c"),
      text("message.appended", "!", "Hello!", "d"),
      { type: "message.completed", data: { turnId: "turn_0", message: "Hello!" }, meta: { id: "e" } },
    ];
    const compacted = compactStreamEvents(events);
    expect(compacted).toHaveLength(3);
    expect(compacted[1]).toEqual({
      type: "message.appended",
      data: { turnId: "turn_0", sequence: 0, stepIndex: 0, messageDelta: "Hello!", messageSoFar: "Hello!" },
      meta: { id: "d" },
    });
  });

  it("keeps runs from different steps and types apart", () => {
    const events = [
      text("reasoning.appended", "a", "a", "1"),
      text("message.appended", "b", "b", "2"),
      text("message.appended", "c", "c", "3", 1),
    ];
    expect(compactStreamEvents(events)).toHaveLength(3);
  });

  it("merges only contiguous tool-input deltas for the same call", () => {
    const input = (callId: string, offset: number, delta: string, id: string) => ({
      type: "action.input.appended",
      data: { callId, inputTextOffset: offset, inputTextDelta: delta, toolName: "web_search" },
      meta: { id },
    });
    const compacted = compactStreamEvents([
      input("c1", 0, '{"q":', "1"),
      input("c1", 5, '"x"}', "2"),
      input("c2", 0, "{}", "3"),
      input("c2", 9, "gap", "4"),
    ]);
    expect(compacted).toHaveLength(3);
    expect(compacted[0]?.data).toMatchObject({ inputTextOffset: 0, inputTextDelta: '{"q":"x"}' });
  });
});

describe("firstChangedIndex", () => {
  const same = (a: number, b: number) => a === b;
  it("finds where a checkpoint has to start writing", () => {
    expect(firstChangedIndex([1, 2, 3], [1, 2, 4, 5], same)).toBe(2);
    expect(firstChangedIndex([1, 2], [1, 2, 3], same)).toBe(2);
    expect(firstChangedIndex([], [1], same)).toBe(0);
  });
});
