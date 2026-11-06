import { defaultMessageReducer } from "eve/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatQuickNow, parseQuickDecision, quickReplySystemPrompt } from "./quick-reply";
import {
  hasAgentEvents,
  quickHandoffContext,
  quickHistoryFromEvents,
  quickTurnEvents,
  startsWithSkillMention,
} from "./quick-reply-client";
import { signQuickRouteHint, verifyQuickRouteHint } from "./quick-route-hint";
import type { MessageStreamEvent } from "eve/client";

describe("parseQuickDecision", () => {
  it("waits for the end of the decision line", () => {
    expect(parseQuickDecision("ANS")).toEqual({ status: "pending" });
    expect(parseQuickDecision("AGENT rea")).toEqual({ status: "pending" });
  });

  it("reads an answer and keeps the text after the line", () => {
    expect(parseQuickDecision("ANSWER\nIt is Friday.")).toEqual({
      status: "decided",
      decision: { mode: "answer" },
      rest: "It is Friday.",
    });
  });

  it("reads a hand-off with its route, tolerating formatting", () => {
    expect(parseQuickDecision("**AGENT complex**\nResearching that now.")).toEqual({
      status: "decided",
      decision: { mode: "agent", route: "complex" },
      rest: "Researching that now.",
    });
    expect(parseQuickDecision("agent\nOn it.")).toMatchObject({
      decision: { mode: "agent", route: "reason" },
    });
  });

  it("treats anything else as invalid so the agent takes over", () => {
    expect(parseQuickDecision("Sure! Today is Friday.\n")).toEqual({ status: "invalid" });
    expect(parseQuickDecision("x".repeat(80))).toEqual({ status: "invalid" });
    expect(parseQuickDecision("ANSWER fast\nhi")).toEqual({ status: "invalid" });
  });
});

describe("quick reply prompt", () => {
  it("states the user's local date and falls back to UTC for a bad zone", () => {
    const now = new Date("2026-11-06T17:30:00Z");
    expect(formatQuickNow(now, "America/Los_Angeles")).toContain("November 6, 2026");
    expect(formatQuickNow(now, "America/Los_Angeles")).toContain("(America/Los_Angeles)");
    expect(formatQuickNow(now, "Not/AZone")).toContain("(UTC)");
  });

  it("includes the user's standing instructions and saved notes", () => {
    const prompt = quickReplySystemPrompt({
      appName: "Jarvis",
      now: new Date("2026-11-06T17:30:00Z"),
      instructionOverlay: "Answer like a pirate.",
      profileMemory: "- Lives in Seattle",
      userName: "Sam",
    });
    expect(prompt).toContain("Answer like a pirate.");
    expect(prompt).toContain("Lives in Seattle");
    expect(prompt).toContain("Sam");
  });
});

describe("quick route hint", () => {
  const previous = process.env.BETTER_AUTH_SECRET;
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = previous;
  });

  it("verifies for the same user only, and only until it expires", () => {
    const now = 1_000_000;
    const hint = signQuickRouteHint("user-1", "complex", now);
    expect(verifyQuickRouteHint(hint, "user-1", now + 1_000)).toBe("complex");
    expect(verifyQuickRouteHint(hint, "user-2", now + 1_000)).toBeNull();
    expect(verifyQuickRouteHint(hint, "user-1", now + 10 * 60_000)).toBeNull();
  });

  it("rejects a tampered route", () => {
    const hint = signQuickRouteHint("user-1", "fast") ?? "";
    expect(verifyQuickRouteHint(hint.replace(/^fast/, "complex"), "user-1")).toBeNull();
    expect(verifyQuickRouteHint("complex.123.abc", "user-1")).toBeNull();
    expect(verifyQuickRouteHint(undefined, "user-1")).toBeNull();
  });
});

describe("quick turn events", () => {
  const events = quickTurnEvents("quick_1", "What day is it?", "It is Friday.");

  it("replay through eve's reducer as a user prompt and an assistant reply", () => {
    const reducer = defaultMessageReducer();
    const data = events.reduce(reducer.reduce, reducer.initial());
    expect(data.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(data.messages[1]?.parts)).toContain("It is Friday.");
  });

  it("are not agent events, and round-trip into hand-off context", () => {
    expect(hasAgentEvents(events)).toBe(false);
    const agentEvent = {
      type: "turn.started",
      data: { sequence: 0, turnId: "turn_1" },
      meta: { at: "", id: "1" },
    } as MessageStreamEvent;
    expect(hasAgentEvents([...events, agentEvent])).toBe(true);

    const history = quickHistoryFromEvents(events);
    expect(history).toEqual([{ prompt: "What day is it?", reply: "It is Friday." }]);
    expect(quickHandoffContext(history)).toContain("Assistant: It is Friday.");
    expect(quickHandoffContext([])).toBeUndefined();
  });

  it("skips the quick layer for a skill mention", () => {
    expect(startsWithSkillMention("/plan my week")).toBe(true);
    expect(startsWithSkillMention("what is 1/2 of 10")).toBe(false);
  });
});
