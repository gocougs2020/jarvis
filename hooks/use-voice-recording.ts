"use client";

import { useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "listening" | "transcribing";

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

export function useVoiceRecording() {
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [error, setError] = useState<string>();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const streamRef = useRef<MediaStream | undefined>(undefined);

  const stopStream = () => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = undefined;
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      stopStream();
    };
  }, []);

  const start = async () => {
    setError(undefined);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(media, { mimeType })
        : new MediaRecorder(media);
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.start(250);
      recorderRef.current = recorder;
      streamRef.current = media;
      setVoice("listening");
    } catch {
      setError("Microphone access is required for voice input.");
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    chunksRef.current = [];
    recorderRef.current = null;
    stopStream();
    setVoice("idle");
  };

  const finish = async (): Promise<string | undefined> => {
    const recorder = recorderRef.current;
    if (!recorder) return undefined;
    cancelledRef.current = false;
    setVoice("transcribing");

    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        },
        { once: true },
      );
      if (recorder.state === "inactive") {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        return;
      }
      recorder.stop();
    });

    recorderRef.current = null;
    stopStream();
    chunksRef.current = [];

    if (cancelledRef.current) {
      setVoice("idle");
      return undefined;
    }
    if (blob.size === 0) {
      setVoice("idle");
      setError("Couldn't capture that recording. Try again.");
      return undefined;
    }

    const mediaType = blob.type.split(";")[0] || "audio/webm";
    const filename = mediaType.includes("mp4") ? "recording.m4a" : "recording.webm";
    const form = new FormData();
    form.append("audio", new File([blob], filename, { type: mediaType }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/transcribe", {
        body: form,
        method: "POST",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        text?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Transcription failed.");
      }
      const text = payload.text?.trim();
      if (!text) {
        setError("No speech detected. Try again.");
        return undefined;
      }
      return text;
    } catch (transcriptionError) {
      if (transcriptionError instanceof DOMException && transcriptionError.name === "AbortError") {
        return undefined;
      }
      setError("Couldn't transcribe that recording. Try again.");
      return undefined;
    } finally {
      setVoice("idle");
    }
  };

  return { cancel, error, finish, start, voice };
}
