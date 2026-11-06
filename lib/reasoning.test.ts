import { describe, expect, it } from "vitest";
import { outputTokenBudget } from "./reasoning";

describe("outputTokenBudget", () => {
  it("adds no headroom when reasoning is off", () => {
    expect(outputTokenBudget("none", 220)).toBe(220);
  });

  it("leaves room for reasoning tokens on top of the answer", () => {
    expect(outputTokenBudget("low", 220)).toBeGreaterThan(220);
    expect(outputTokenBudget("high", 40)).toBeGreaterThan(outputTokenBudget("medium", 40));
  });
});
