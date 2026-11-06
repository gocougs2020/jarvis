"use client";

import { useEffect, useRef } from "react";
import { createVoiceActivityDetector, rmsLevel, type VoiceActivity } from "@/lib/voice-activity";
import { getVoiceAudioContext } from "@/lib/voice-mode";

const tickMs = 50;

/**
 * Watch a live microphone stream and call `onResult` once when the speaker
 * stops talking (or never starts). Used by hands-free voice mode to send a
 * recording without a tap.
 */
export function useVoiceActivity({
  enabled,
  onResult,
  stream,
}: {
  readonly enabled: boolean;
  readonly onResult: (result: Exclude<VoiceActivity, "listening">) => void;
  readonly stream?: MediaStream;
}) {
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    if (!enabled || !stream) return;
    const context = getVoiceAudioContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const detect = createVoiceActivityDetector();
    let done = false;

    const timer = window.setInterval(() => {
      // A suspended context reads silence; don't let that count as "no speech".
      if (done || context.state !== "running") return;
      analyser.getFloatTimeDomainData(samples);
      const result = detect(rmsLevel(samples), performance.now());
      if (result === "listening") return;
      done = true;
      window.clearInterval(timer);
      onResultRef.current(result);
    }, tickMs);

    return () => {
      done = true;
      window.clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }, [enabled, stream]);
}
