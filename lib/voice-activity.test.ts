import { describe, expect, it } from "vitest";
import { createVoiceActivityDetector, rmsLevel } from "./voice-activity";

function run(levels: Array<[level: number, ms: number]>, tickMs = 50) {
  const detect = createVoiceActivityDetector();
  let now = 0;
  let result = detect(levels[0]?.[0] ?? 0, now);
  for (const [level, duration] of levels) {
    for (let elapsed = 0; elapsed < duration; elapsed += tickMs) {
      now += tickMs;
      result = detect(level, now);
      if (result !== "listening") return { now, result };
    }
  }
  return { now, result };
}

describe("createVoiceActivityDetector", () => {
  it("waits for speech, then sends after a pause", () => {
    const { now, result } = run([
      [0.005, 1_000],
      [0.15, 2_000],
      [0.005, 3_000],
    ]);
    expect(result).toBe("speech-ended");
    // Ended about silenceMs after the last loud tick.
    expect(now).toBeGreaterThanOrEqual(3_000 + 1_300);
    expect(now).toBeLessThan(3_000 + 1_500);
  });

  it("does not send on a short click", () => {
    const { result } = run([
      [0.005, 500],
      [0.3, 100],
      [0.005, 3_000],
    ]);
    expect(result).toBe("listening");
  });

  it("gives up when nobody speaks", () => {
    expect(run([[0.005, 13_000]]).result).toBe("no-speech");
  });

  it("raises the bar in a noisy room", () => {
    // Steady background at 0.03 is above the floor minimum but is not speech.
    expect(run([[0.03, 5_000]]).result).toBe("listening");
    expect(
      run([
        [0.03, 1_000],
        [0.2, 1_000],
        [0.03, 2_000],
      ]).result,
    ).toBe("speech-ended");
  });

  it("keeps listening through short pauses between words", () => {
    const { result } = run([
      [0.15, 800],
      [0.005, 600],
      [0.15, 800],
      [0.005, 600],
    ]);
    expect(result).toBe("listening");
  });
});

describe("rmsLevel", () => {
  it("measures a buffer", () => {
    expect(rmsLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsLevel(new Float32Array())).toBe(0);
  });
});
