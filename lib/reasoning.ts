import type { ReasoningEffort } from "../app.config";

/**
 * Reasoning tokens count against `maxOutputTokens` on OpenAI (and most
 * reasoning providers), so a cap sized for the answer alone can be spent
 * before any answer is written. Each call adds this headroom on top of the
 * tokens its answer needs. It is a ceiling, not a charge.
 */
const REASONING_HEADROOM_TOKENS: Readonly<Record<ReasoningEffort, number>> = {
  "provider-default": 8_000,
  none: 0,
  minimal: 1_000,
  low: 2_000,
  medium: 8_000,
  high: 24_000,
  xhigh: 32_000,
};

export function outputTokenBudget(effort: ReasoningEffort, answerTokens: number): number {
  return answerTokens + REASONING_HEADROOM_TOKENS[effort];
}
