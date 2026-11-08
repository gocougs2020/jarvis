import { describe, expect, it } from "vitest";
import { estimateTranscriptionCostUsd } from "@/lib/model-prices";

describe("transcription pricing", () => {
  it("prices Grok STT at its Gateway rate and falls back for unknown models", () => {
    expect(estimateTranscriptionCostUsd(60, undefined, "spacexai/grok-stt")).toBeCloseTo(0.00168);
    expect(estimateTranscriptionCostUsd(60)).toBeCloseTo(0.0045);
  });
});
