import { describe, expect, it } from "vitest";
import {
  decodePcm16,
  encodePcm16,
  reduceTranscript,
  resample,
  type TranscriptEvent,
  type VoiceTurn,
} from "./voice-call-logic";

function fold(events: readonly TranscriptEvent[]): readonly VoiceTurn[] {
  return events.reduce<readonly VoiceTurn[]>(reduceTranscript, []);
}

describe("PCM16 audio", () => {
  it("round-trips samples through base64 PCM16", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
    const decoded = decodePcm16(encodePcm16(samples));
    expect(decoded).toHaveLength(samples.length);
    samples.forEach((value, index) => {
      expect(decoded[index]).toBeCloseTo(value, 3);
    });
  });

  it("clamps out-of-range samples", () => {
    const decoded = decodePcm16(encodePcm16(new Float32Array([2, -2])));
    expect(decoded[0]).toBeCloseTo(1, 3);
    expect(decoded[1]).toBe(-1);
  });

  it("resamples 48 kHz down to 24 kHz", () => {
    const input = new Float32Array(960).map((_, index) => index / 960);
    const output = resample(input, 48_000, 24_000);
    expect(output).toHaveLength(480);
    expect(output[240]).toBeCloseTo(input[480]!, 5);
    expect(resample(input, 24_000, 24_000)).toBe(input);
  });
});

describe("reduceTranscript", () => {
  it("keeps the user's turn before the reply even when transcription lands late", () => {
    const turns = fold([
      { type: "speech-started", itemId: "u1" },
      { type: "audio-committed", itemId: "u1" },
      { type: "audio-transcript-delta", itemId: "a1", delta: "Hi " },
      { type: "audio-transcript-delta", itemId: "a1", delta: "there." },
      { type: "input-transcription-completed", itemId: "u1", transcript: " Hello " },
      { type: "audio-transcript-done", itemId: "a1" },
    ]);
    expect(turns).toEqual([
      { id: "u1", role: "user", text: "Hello", final: true },
      { id: "a1", role: "assistant", text: "Hi there.", final: true },
    ]);
  });

  it("adopts the committed item id when speech started without one", () => {
    const turns = fold([
      { type: "speech-started" },
      { type: "audio-committed", itemId: "u9" },
      { type: "input-transcription-completed", itemId: "u9", transcript: "Yes" },
    ]);
    expect(turns).toEqual([{ id: "u9", role: "user", text: "Yes", final: true }]);
  });

  it("keeps overlapping utterances apart when transcriptions land late", () => {
    const turns = fold([
      { type: "speech-started", itemId: "u1" },
      { type: "speech-started", itemId: "u2" },
      { type: "input-transcription-completed", itemId: "u2", transcript: "second" },
      { type: "input-transcription-completed", itemId: "u1", transcript: "first" },
    ]);
    expect(turns).toEqual([
      { id: "u1", role: "user", text: "first", final: true },
      { id: "u2", role: "user", text: "second", final: true },
    ]);
  });

  it("drops a user bubble whose transcription came back empty", () => {
    const turns = fold([
      { type: "speech-started", itemId: "u1" },
      { type: "input-transcription-completed", itemId: "u1", transcript: "  " },
    ]);
    expect(turns).toEqual([]);
  });

  it("settles a reply that was talked over", () => {
    const turns = fold([
      { type: "audio-transcript-delta", itemId: "a1", delta: "Let me tell you" },
      { type: "speech-started", itemId: "u2" },
    ]);
    expect(turns[0]).toMatchObject({ id: "a1", final: true });
    expect(turns[1]).toMatchObject({ id: "u2", role: "user", final: false });
  });

  it("prefers the final transcript over streamed deltas", () => {
    const turns = fold([
      { type: "audio-transcript-delta", itemId: "a1", delta: "Helo" },
      { type: "audio-transcript-done", itemId: "a1", transcript: "Hello." },
    ]);
    expect(turns).toEqual([{ id: "a1", role: "assistant", text: "Hello.", final: true }]);
  });

  it("ignores events it does not render", () => {
    const turns: readonly VoiceTurn[] = [];
    expect(
      reduceTranscript(turns, { type: "session-created" } as unknown as TranscriptEvent),
    ).toBe(turns);
  });
});
