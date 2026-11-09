/**
 * Pure helpers for the voice-mode call (`lib/voice-call.ts`): PCM16 audio
 * encoding for the AI Gateway realtime protocol and the live transcript the
 * voice screen renders. No browser APIs here, so it runs under vitest.
 */

/** Sample rate the realtime protocol uses for PCM16 in both directions. */
export const REALTIME_SAMPLE_RATE = 24_000;

/** Linear-interpolation resample; good enough for speech. */
export function resample(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate || input.length === 0) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const position = index * ratio;
    const low = Math.min(Math.floor(position), input.length - 1);
    const high = Math.min(low + 1, input.length - 1);
    const fraction = position - low;
    output[index] = input[low]! * (1 - fraction) + input[high]! * fraction;
  }
  return output;
}

/** Float32 samples in [-1, 1] to base64 little-endian PCM16. */
export function encodePcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Base64 little-endian PCM16 to Float32 samples in [-1, 1]. */
export function decodePcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const count = Math.floor(binary.length / 2);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    let value = (high << 8) | low;
    if (value >= 0x8000) value -= 0x10000;
    samples[index] = value / 0x8000;
  }
  return samples;
}

export type VoiceTurn = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  /** False while the words are still arriving (or, for the user, being transcribed). */
  readonly final: boolean;
};

/** The subset of normalized realtime server events the transcript uses. */
export type TranscriptEvent =
  | { readonly type: "speech-started"; readonly itemId?: string }
  | { readonly type: "audio-committed"; readonly itemId?: string }
  | {
      readonly type: "input-transcription-completed";
      readonly itemId?: string;
      readonly transcript?: string;
    }
  | {
      readonly type: "audio-transcript-delta" | "text-delta";
      readonly itemId?: string;
      readonly delta?: string;
    }
  | {
      readonly type: "audio-transcript-done";
      readonly itemId?: string;
      readonly transcript?: string;
    }
  | { readonly type: "text-done"; readonly itemId?: string; readonly text?: string }
  | { readonly type: "response-done" };

const MAX_TURNS = 200;
let localIds = 0;
const localId = (role: VoiceTurn["role"]) => `local-${role}-${++localIds}`;

function replaceAt(
  turns: readonly VoiceTurn[],
  index: number,
  next: VoiceTurn,
): VoiceTurn[] {
  const copy = turns.slice();
  copy[index] = next;
  return copy;
}

function pendingUserIndex(turns: readonly VoiceTurn[], itemId?: string): number {
  if (itemId) {
    const byId = turns.findIndex((turn) => turn.id === itemId);
    if (byId >= 0) return byId;
  }
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!;
    if (turn.role === "user" && !turn.final) return index;
  }
  return -1;
}

function cap(turns: VoiceTurn[]): VoiceTurn[] {
  return turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
}

/**
 * Folds one server event into the transcript. The user's bubble appears when
 * they start talking (so it sits before the reply) and fills in when the
 * transcription lands; the assistant's words stream in as they are spoken.
 */
export function reduceTranscript(
  turns: readonly VoiceTurn[],
  event: TranscriptEvent,
): readonly VoiceTurn[] {
  switch (event.type) {
    case "speech-started": {
      // Close any reply that was cut off by the user talking over it.
      const settled = turns.map((turn) =>
        turn.role === "assistant" && !turn.final ? { ...turn, final: true } : turn,
      );
      if (pendingUserIndex(settled, event.itemId) >= 0) return settled;
      return cap([
        ...settled,
        { id: event.itemId ?? localId("user"), role: "user", text: "", final: false },
      ]);
    }
    case "audio-committed": {
      const index = pendingUserIndex(turns);
      if (index < 0 || !event.itemId || turns[index]!.id === event.itemId)
        return turns;
      return replaceAt(turns, index, { ...turns[index]!, id: event.itemId });
    }
    case "input-transcription-completed": {
      const text = event.transcript?.trim() ?? "";
      const index = pendingUserIndex(turns, event.itemId);
      if (index < 0) {
        if (!text) return turns;
        return cap([
          ...turns,
          { id: event.itemId ?? localId("user"), role: "user", text, final: true },
        ]);
      }
      if (!text) return turns.filter((_, at) => at !== index);
      return replaceAt(turns, index, { ...turns[index]!, text, final: true });
    }
    case "audio-transcript-delta":
    case "text-delta": {
      if (!event.delta) return turns;
      const id = event.itemId ?? "assistant-current";
      const index = turns.findIndex((turn) => turn.id === id);
      if (index < 0) {
        return cap([
          ...turns,
          { id, role: "assistant", text: event.delta, final: false },
        ]);
      }
      const turn = turns[index]!;
      return replaceAt(turns, index, { ...turn, text: turn.text + event.delta });
    }
    case "audio-transcript-done":
    case "text-done": {
      const id = event.itemId ?? "assistant-current";
      const full = event.type === "text-done" ? event.text : event.transcript;
      const index = turns.findIndex((turn) => turn.id === id);
      if (index < 0) {
        if (!full?.trim()) return turns;
        return cap([...turns, { id, role: "assistant", text: full.trim(), final: true }]);
      }
      const turn = turns[index]!;
      return replaceAt(turns, index, {
        ...turn,
        text: full?.trim() ? full.trim() : turn.text,
        final: true,
      });
    }
    case "response-done": {
      if (!turns.some((turn) => turn.role === "assistant" && !turn.final))
        return turns;
      return turns.map((turn) =>
        turn.role === "assistant" && !turn.final ? { ...turn, final: true } : turn,
      );
    }
    default:
      return turns;
  }
}
