/**
 * End-of-speech detection for hands-free voice mode. Feed it the microphone's
 * RMS level (0..1) on a steady tick; it tracks the room's noise floor, waits
 * until the speaker has actually said something, then reports when they have
 * been quiet long enough to send.
 */
export type VoiceActivity = "listening" | "speech-ended" | "no-speech" | "too-long";

export type VoiceActivityOptions = {
  /** Quiet time after speech before the recording is sent. */
  readonly silenceMs?: number;
  /** Give up when nothing was said for this long. */
  readonly noSpeechMs?: number;
  /** Send anyway once a recording runs this long. */
  readonly maxMs?: number;
  /** Speech shorter than this (a cough, a click) does not count. */
  readonly minSpeechMs?: number;
  /** Lowest level that can count as speech, however quiet the room. */
  readonly minThreshold?: number;
};

export function createVoiceActivityDetector({
  silenceMs = 1_300,
  noSpeechMs = 12_000,
  maxMs = 90_000,
  minSpeechMs = 250,
  minThreshold = 0.02,
}: VoiceActivityOptions = {}) {
  let startedAt: number | undefined;
  let lastAt: number | undefined;
  let noiseFloor: number | undefined;
  let speechMs = 0;
  let lastVoiceAt: number | undefined;

  return (level: number, now: number): VoiceActivity => {
    startedAt ??= now;
    const step = lastAt === undefined ? 0 : Math.max(0, now - lastAt);
    lastAt = now;
    const elapsed = now - startedAt;
    if (elapsed >= maxMs) return speechMs >= minSpeechMs ? "too-long" : "no-speech";

    noiseFloor ??= level;
    const threshold = Math.max(minThreshold, noiseFloor * 3);
    if (level > threshold) {
      speechMs += step;
      lastVoiceAt = now;
    } else {
      // Follow the room down quickly and up slowly, so a steady fan or hum
      // raises the bar without a long sentence dragging it up.
      noiseFloor = level < noiseFloor ? level : noiseFloor + (level - noiseFloor) * 0.05;
    }

    const heardSpeech = speechMs >= minSpeechMs;
    if (heardSpeech && lastVoiceAt !== undefined && now - lastVoiceAt >= silenceMs) {
      return "speech-ended";
    }
    if (!heardSpeech && elapsed >= noSpeechMs) return "no-speech";
    return "listening";
  };
}

/** Root-mean-square level of a time-domain sample buffer in -1..1. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
