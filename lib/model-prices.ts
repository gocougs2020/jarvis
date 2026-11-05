/** USD per 1M tokens. Long-context rates apply to the whole request above the threshold. */
export type ModelTokenRates = {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly longInput?: number;
  readonly longCacheRead?: number;
  readonly longCacheWrite?: number;
  readonly longOutput?: number;
};

export type UsageTokens = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
};

/** OpenAI bills the full request at long-context rates above this input size. */
export const LONG_CONTEXT_INPUT_TOKENS = 272_000;

const PER_MILLION = 1_000_000;

/**
 * Catalog keys are model ids without a provider prefix (`gpt-5.6-luna`).
 * Luna Fast is OpenAI Fast mode pricing (2× standard Luna).
 */
const TOKEN_RATES: Readonly<Record<string, ModelTokenRates>> = {
  "gpt-5.6-luna": {
    input: 0.2,
    cacheRead: 0.02,
    cacheWrite: 0.25,
    output: 1.2,
    longInput: 0.4,
    longCacheRead: 0.04,
    longCacheWrite: 0.5,
    longOutput: 1.8,
  },
  "gpt-5.6-luna-fast": {
    input: 0.4,
    cacheRead: 0.04,
    cacheWrite: 0.5,
    output: 2.4,
    longInput: 0.8,
    longCacheRead: 0.08,
    longCacheWrite: 1,
    longOutput: 3.6,
  },
  "gpt-5.6-sol": {
    input: 4,
    cacheRead: 0.4,
    cacheWrite: 5,
    output: 20,
    longInput: 8,
    longCacheRead: 0.8,
    longCacheWrite: 10,
    longOutput: 30,
  },
  "text-embedding-3-small": {
    input: 0.02,
    cacheRead: 0.02,
    cacheWrite: 0.02,
    output: 0,
  },
  "gpt-image-2": {
    input: 5,
    cacheRead: 1.25,
    cacheWrite: 5,
    output: 30,
  },
};

const IMAGE_FALLBACK_USD: Readonly<Record<string, { square: number; other: number }>> = {
  low: { square: 0.006, other: 0.005 },
  medium: { square: 0.053, other: 0.041 },
  high: { square: 0.211, other: 0.165 },
};

/** AI Gateway list price per second of audio, by transcription model. */
const TRANSCRIPTION_USD_PER_SECOND: Readonly<Record<string, number>> = {
  "spacexai/grok-stt": 0.000028,
  "openai/gpt-transcribe": 0.000075,
  "openai/whisper-1": 0.0001,
};

/** Fallback for a transcription model not listed above (openai/gpt-transcribe). */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.0045;

/** AI Gateway list price per input character, by speech (text-to-speech) model. */
const SPEECH_USD_PER_CHARACTER: Readonly<Record<string, number>> = {
  "spacexai/grok-tts": 0.000015,
  "openai/tts-1": 0.000015,
  "openai/tts-1-hd": 0.00003,
};
const SPEECH_FALLBACK_USD_PER_CHARACTER = 0.000015;

export function estimateSpeechCostUsd(modelId: string, characters: number): number {
  const rate = SPEECH_USD_PER_CHARACTER[modelId.trim().toLowerCase()] ?? SPEECH_FALLBACK_USD_PER_CHARACTER;
  return Math.max(0, characters) * rate;
}

/** AI Gateway Exa search. List rate is $7 / 1k requests (up to 10 results). */
export const EXA_SEARCH_MODEL_ID = "exa/search";
export const EXA_SEARCH_USD_PER_REQUEST = 0.007;

export function catalogModelKey(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/^[^/]+\//, "");
}

export function displayModelId(modelId: string): string {
  if (modelId === EXA_SEARCH_MODEL_ID) return "Exa search";
  return modelId.replace(/^openai\//, "");
}

export function ratesForModel(modelId: string): ModelTokenRates | undefined {
  const key = catalogModelKey(modelId);
  return TOKEN_RATES[key] ?? TOKEN_RATES[modelId.trim().toLowerCase()];
}

export function emptyUsageTokens(): UsageTokens {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function addUsageTokens(left: UsageTokens, right: UsageTokens): UsageTokens {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  };
}

export function estimateUsageCost(modelId: string, tokens: UsageTokens): number {
  const rates = ratesForModel(modelId);
  if (!rates) return 0;
  const long = tokens.inputTokens > LONG_CONTEXT_INPUT_TOKENS;
  const inputRate = long && rates.longInput != null ? rates.longInput : rates.input;
  const cacheReadRate = long && rates.longCacheRead != null ? rates.longCacheRead : rates.cacheRead;
  const cacheWriteRate =
    long && rates.longCacheWrite != null ? rates.longCacheWrite : rates.cacheWrite;
  const outputRate = long && rates.longOutput != null ? rates.longOutput : rates.output;
  const cacheRead = Math.max(0, tokens.cacheReadTokens);
  const cacheWrite = Math.max(0, tokens.cacheWriteTokens);
  const uncached = Math.max(0, tokens.inputTokens - cacheRead - cacheWrite);
  return (
    (uncached * inputRate +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate +
      tokens.outputTokens * outputRate) /
    PER_MILLION
  );
}

export function estimateImageCostUsd(quality: string, size: string, count: number): number {
  const tier = IMAGE_FALLBACK_USD[quality] ?? IMAGE_FALLBACK_USD.medium;
  const perImage = size === "1024x1024" ? tier.square : tier.other;
  return perImage * Math.max(1, count);
}

export function estimateTranscriptionCostUsd(
  durationSeconds?: number,
  audioBytes?: number,
  modelId?: string,
): number {
  const minutes =
    durationSeconds != null && Number.isFinite(durationSeconds)
      ? durationSeconds / 60
      : audioBytes != null && Number.isFinite(audioBytes)
        ? audioBytes / (3_000 * 60)
        : 0;
  const perSecond = modelId
    ? TRANSCRIPTION_USD_PER_SECOND[modelId.trim().toLowerCase()]
    : undefined;
  const perMinute = perSecond != null ? perSecond * 60 : TRANSCRIPTION_USD_PER_MINUTE;
  return Math.max(0, minutes) * perMinute;
}
