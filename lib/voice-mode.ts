"use client";

import { useSyncExternalStore } from "react";

/**
 * Voice mode: a hands-free loop. Turning it on starts listening; when the
 * speaker goes quiet the recording is transcribed and sent, the reply is read
 * aloud when the turn settles, and then the composer listens again. The toggle
 * is a per-viewer convenience, so it lives in localStorage and defaults to off.
 *
 * State is module-level (not component state) because the composer remounts
 * when the landing page turns into a chat, and the loop must survive that.
 */
const VOICE_MODE_KEY = "voice-mode";

/** Spoken-reply playback: nothing, fetching audio, or audible. */
export type SpeechState = "idle" | "loading" | "playing";

/**
 * Hands-free loop position: nothing pending, a voice prompt was sent and its
 * turn has not started yet, or that turn (and its spoken reply) is under way.
 */
export type VoiceLoop = "idle" | "sent" | "replying";

export type VoiceSession = {
  readonly loop: VoiceLoop;
  readonly on: boolean;
  readonly speech: SpeechState;
};

const serverSnapshot: VoiceSession = { loop: "idle", on: false, speech: "idle" };
const listeners = new Set<() => void>();
let snapshot: VoiceSession | undefined;

function readVoiceMode(): boolean {
  try {
    return window.localStorage.getItem(VOICE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function getSnapshot(): VoiceSession {
  if (typeof window === "undefined") return serverSnapshot;
  snapshot ??= { loop: "idle", on: readVoiceMode(), speech: "idle" };
  return snapshot;
}

function update(patch: Partial<VoiceSession>) {
  const current = getSnapshot();
  const next = { ...current, ...patch };
  if (next.loop === current.loop && next.on === current.on && next.speech === current.speech) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function isVoiceModeOn(): boolean {
  return getSnapshot().on;
}

export function getVoiceSession(): VoiceSession {
  return getSnapshot();
}

export function setVoiceMode(on: boolean) {
  try {
    if (on) window.localStorage.setItem(VOICE_MODE_KEY, "1");
    else window.localStorage.removeItem(VOICE_MODE_KEY);
  } catch {
    // Private mode or blocked storage: keep the in-memory value for this tab.
  }
  if (!on) stopSpeaking();
  update({ loop: "idle", on });
}

export function setVoiceLoop(loop: VoiceLoop) {
  update({ loop });
}

export function useVoiceSession(): VoiceSession {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

let audioContext: AudioContext | undefined;
let speechAnalyser: AnalyserNode | undefined;

/**
 * One shared AudioContext for voice mode: it plays spoken replies (feeding the
 * speaking waveform) and analyses the microphone. Safari only lets a context
 * run once it was created or resumed inside a user gesture, so callers prime it
 * from a click with `primeVoiceAudio` and every later use reuses it.
 */
export function getVoiceAudioContext(): AudioContext | undefined {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return undefined;
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
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

function getSpeechOutput(context: AudioContext): AnalyserNode {
  if (!speechAnalyser || speechAnalyser.context !== context) {
    speechAnalyser = context.createAnalyser();
    speechAnalyser.fftSize = 64;
    speechAnalyser.smoothingTimeConstant = 0.6;
    speechAnalyser.connect(context.destination);
  }
  return speechAnalyser;
}

type Playback = {
  abort: AbortController;
  analysed: boolean;
  stop?: () => void;
};

let playing: Playback | undefined;

/** The analyser for the reply being spoken, when it plays through Web Audio. */
export function getSpeechAnalyser(): AnalyserNode | undefined {
  return playing?.analysed ? speechAnalyser : undefined;
}

export function stopSpeaking() {
  const current = playing;
  if (!current) return;
  playing = undefined;
  current.abort.abort();
  current.stop?.();
  update({ speech: "idle" });
}

async function playThroughContext(run: Playback, bytes: ArrayBuffer): Promise<boolean> {
  const context = getVoiceAudioContext();
  if (!context || context.state !== "running") return false;
  let buffer: AudioBuffer;
  try {
    // decodeAudioData detaches its input; keep `bytes` for the fallback.
    buffer = await context.decodeAudioData(bytes.slice(0));
  } catch {
    return false;
  }
  if (playing !== run) return true;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(getSpeechOutput(context));
  await new Promise<void>((resolve) => {
    source.addEventListener("ended", () => resolve(), { once: true });
    run.stop = () => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      resolve();
    };
    run.analysed = true;
    update({ speech: "playing" });
    source.start();
  });
  source.disconnect();
  return true;
}

async function playThroughElement(run: Playback, bytes: ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      audio.addEventListener("ended", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("Audio playback failed.")), {
        once: true,
      });
      run.stop = () => {
        audio.pause();
        resolve();
      };
      update({ speech: "playing" });
      audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Speak `text` through `/api/speech`. A new call (or `stopSpeaking`) interrupts
 * the last one. Resolves when playback ends, is interrupted, or fails.
 */
export async function speakText(text: string, chatId?: string): Promise<void> {
  stopSpeaking();
  if (!text.trim()) return;
  const run: Playback = { abort: new AbortController(), analysed: false };
  playing = run;
  update({ speech: "loading" });
  try {
    const response = await fetch("/api/speech", {
      body: JSON.stringify({ chatId, text }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: run.abort.signal,
    });
    if (!response.ok) throw new Error(`Speech request failed (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (playing !== run) return;
    const played = await playThroughContext(run, bytes);
    if (!played && playing === run) {
      await playThroughElement(run, bytes, response.headers.get("Content-Type") || "audio/mpeg");
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    // Autoplay can be blocked until the page has had a user gesture; the
    // reply is still on screen, so fail quietly.
    console.warn("[voice] could not play reply", error);
  } finally {
    if (playing === run) {
      playing = undefined;
      update({ speech: "idle" });
    }
  }
}
