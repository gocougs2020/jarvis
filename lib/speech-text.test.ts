import { describe, expect, it } from "vitest";
import { speakableText } from "@/lib/speech-text";
import { latestTurnReplyText } from "@/lib/session-events";
import { estimateSpeechCostUsd, estimateTranscriptionCostUsd } from "@/lib/model-prices";
import type { MessageStreamEvent } from "eve/client";

describe("speakableText", () => {
  it("strips markup, links, citations, and code", () => {
    const spoken = speakableText(
      "## Plan\n\n- **Buy** milk [1]\n- See [the docs](https://example.com)\n\n```ts\nconst x = 1;\n```",
      500,
    );
    expect(spoken).toBe("Plan\nBuy milk\nSee the docs\n(code omitted)");
  });

  it("trims long replies at a sentence boundary", () => {
    const spoken = speakableText(`${"One sentence here. ".repeat(20)}`, 60);
    expect(spoken.length).toBeLessThanOrEqual(60);
    expect(spoken.endsWith(".")).toBe(true);
  });
});

describe("latestTurnReplyText", () => {
  it("joins the visible messages of the last turn only", () => {
    const completed = (turnId: string, message: string | null) =>
      ({ type: "message.completed", data: { turnId, message, finishReason: "stop", sequence: 0, stepIndex: 0 } }) as unknown as MessageStreamEvent;
    expect(
      latestTurnReplyText([
        completed("turn_0", "old"),
        completed("turn_1", "Looking that up."),
        completed("turn_1", null),
        completed("turn_1", "Here it is."),
      ]),
    ).toBe("Looking that up.\n\nHere it is.");
  });
});

describe("voice pricing", () => {
  it("prices Grok STT and TTS at their Gateway rates", () => {
    expect(estimateTranscriptionCostUsd(60, undefined, "spacexai/grok-stt")).toBeCloseTo(0.00168);
    expect(estimateTranscriptionCostUsd(60)).toBeCloseTo(0.0045);
    expect(estimateSpeechCostUsd("spacexai/grok-tts", 1000)).toBeCloseTo(0.015);
  });
});
