"use client";

import { useSyncExternalStore } from "react";

/**
 * Voice mode: a dictated prompt is sent as soon as it is transcribed, and the
 * reply is read aloud when the turn settles. The toggle is a per-viewer
 * convenience, so it lives in localStorage and defaults to off.
 */
const VOICE_MODE_KEY = "voice-mode";
const listeners = new Set<() => void>();

function readVoiceMode(): boolean {
  try {
    return window.localStorage.getItem(VOICE_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

let current: boolean | undefined;

export function isVoiceModeOn(): boolean {
  if (typeof window === "undefined") return false;
  current ??= readVoiceMode();
  return current;
}

export function setVoiceMode(on: boolean) {
  current = on;
  try {
    if (on) window.localStorage.setItem(VOICE_MODE_KEY, "1");
    else window.localStorage.removeItem(VOICE_MODE_KEY);
  } catch {
    // Private mode or blocked storage: keep the in-memory value for this tab.
  }
  if (!on) stopSpeaking();
  for (const listener of listeners) listener();
}

export function useVoiceMode(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    isVoiceModeOn,
    () => false,
  );
}

let playing: { audio: HTMLAudioElement; url: string; abort: AbortController } | undefined;

export function stopSpeaking() {
  if (!playing) return;
  playing.abort.abort();
  playing.audio.pause();
  URL.revokeObjectURL(playing.url);
  playing = undefined;
}

/** Speak `text` through `/api/speech`. A new call (or `stopSpeaking`) interrupts the last one. */
export async function speakText(text: string, chatId?: string): Promise<void> {
  stopSpeaking();
  if (!text.trim()) return;
  const abort = new AbortController();
  const placeholder = { audio: new Audio(), url: "", abort };
  playing = placeholder;
  try {
    const response = await fetch("/api/speech", {
      body: JSON.stringify({ chatId, text }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: abort.signal,
    });
    if (!response.ok || playing !== placeholder) return;
    const url = URL.createObjectURL(await response.blob());
    if (playing !== placeholder) {
      URL.revokeObjectURL(url);
      return;
    }
    placeholder.url = url;
    placeholder.audio.src = url;
    placeholder.audio.addEventListener(
      "ended",
      () => {
        if (playing === placeholder) stopSpeaking();
      },
      { once: true },
    );
    await placeholder.audio.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    // Autoplay can be blocked until the page has had a user gesture; the
    // reply is still on screen, so fail quietly.
    console.warn("[voice] could not play reply", error);
  }
}
