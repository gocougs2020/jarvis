import { describe, expect, it } from "vitest";
import { appConfig } from "../../app.config";
import { modelSelectionForRoute, reasoningProviderOptions, modelSelection } from "./models";

describe("reasoningProviderOptions", () => {
  it("uses each provider's own reasoning knob at the requested effort", () => {
    expect(reasoningProviderOptions("openai/gpt-6-luna", "medium")).toEqual({
      openai: { reasoningEffort: "medium" },
    });
    expect(reasoningProviderOptions("anthropic/claude-sonnet-5.5", "high")).toEqual({
      anthropic: { thinking: { type: "enabled", budgetTokens: 16_000 } },
    });
    expect(reasoningProviderOptions("xai/grok-5", "medium")).toEqual({
      xai: { reasoningEffort: "high" },
    });
  });

  it("leaves unknown providers and provider-default on their defaults", () => {
    expect(reasoningProviderOptions("mistral/large", "high")).toBeUndefined();
    expect(reasoningProviderOptions("openai/gpt-6-luna", "provider-default")).toBeUndefined();
    expect(modelSelection("mistral/large", "high")).not.toHaveProperty("modelOptions");
  });
});

describe("modelSelectionForRoute", () => {
  it("pairs each chat route with its configured model and effort", () => {
    const { models } = appConfig;
    const cases = [
      ["fast", models.chatFast, models.reasoning.chatFast],
      ["reason", models.chatLow, models.reasoning.chatLow],
      ["complex", models.chatHigh, models.reasoning.chatHigh],
    ] as const;
    for (const [route, model, effort] of cases) {
      expect(modelSelectionForRoute(route)).toMatchObject({
        model,
        modelOptions: { providerOptions: reasoningProviderOptions(model, effort) },
      });
    }
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
