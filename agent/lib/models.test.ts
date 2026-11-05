import { describe, expect, it } from "vitest";
import { highReasoningProviderOptions, modelSelection } from "./models";

describe("highReasoningProviderOptions", () => {
  it("uses each provider's own reasoning knob", () => {
    expect(highReasoningProviderOptions("openai/gpt-5.6-luna")).toEqual({
      openai: { reasoningEffort: "high" },
    });
    expect(highReasoningProviderOptions("anthropic/claude-sonnet-5.5")).toMatchObject({
      anthropic: { thinking: { type: "enabled" } },
    });
  });

  it("leaves unknown providers on their defaults", () => {
    expect(highReasoningProviderOptions("mistral/large")).toBeUndefined();
    expect(modelSelection("mistral/large", "complex")).not.toHaveProperty("modelOptions");
  });

  it("never forces reasoning on the fast route", () => {
    expect(modelSelection("openai/gpt-5.6-luna-fast", "fast")).not.toHaveProperty("modelOptions");
  });
});

describe("isTrivialPrompt", () => {
  it("skips routing only for very short prompts", async () => {
    const { isTrivialPrompt } = await import("./models");
    expect(isTrivialPrompt("hi")).toBe(true);
    expect(isTrivialPrompt("thanks!")).toBe(true);
    expect(isTrivialPrompt("Compare these two vendor quotes")).toBe(false);
    expect(isTrivialPrompt("")).toBe(false);
  });
});
