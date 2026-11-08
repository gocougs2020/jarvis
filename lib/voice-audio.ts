"use client";

let audioContext: AudioContext | undefined;

/**
 * One shared AudioContext for drawing microphone waveforms. Safari only lets a
 * context run once it was created or resumed inside a user gesture, so callers
 * prime it from a click with `primeVoiceAudio` and every later use reuses it.
 */
export function getVoiceAudioContext(): AudioContext | undefined {
  if (typeof window === "undefined" || typeof AudioContext === "undefined")
    return undefined;
  if (!audioContext) {
    try {
      audioContext = new AudioContext();
    } catch {
      return undefined;
    }
  }
  return audioContext;
}

/** Call from a click/tap so later playback and mic analysis are allowed to run. */
export function primeVoiceAudio() {
  const context = getVoiceAudioContext();
  if (context?.state === "suspended")
    void context.resume().catch(() => undefined);
}
