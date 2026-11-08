"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getVoiceAudioContext } from "@/lib/voice-audio";

const barCount = 28;
const restLevel = 0.12;
const rest = () => Array.from({ length: barCount }, () => restLevel);

function usePrefersReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduceMotion;
}

/**
 * Bars that move with the microphone (`stream`), with a reply being spoken
 * (`analyser`), or — with neither — in a slow wave while something is pending
 * (`pulse`). Otherwise the bars rest flat.
 */
export function VoiceWaveform({
  analyser,
  className,
  pulse,
  stream,
}: {
  readonly analyser?: AnalyserNode;
  readonly className?: string;
  readonly pulse?: boolean;
  readonly stream?: MediaStream;
}) {
  const [levels, setLevels] = useState(rest);
  const reduceMotion = usePrefersReducedMotion();
  const live = Boolean(stream || analyser);

  useEffect(() => {
    if (reduceMotion) return;
    let frame = 0;
    let cleanup = () => {};
    let read: (() => number[]) | undefined;

    if (stream || analyser) {
      let node = analyser;
      if (stream) {
        const context = getVoiceAudioContext();
        if (!context) return;
        const source = context.createMediaStreamSource(stream);
        node = context.createAnalyser();
        node.fftSize = 64;
        source.connect(node);
        const owned = node;
        cleanup = () => {
          source.disconnect();
          owned.disconnect();
        };
      }
      if (!node) return;
      const data = new Uint8Array(node.frequencyBinCount);
      // Speech energy sits in the lower bins; spread the bars over those.
      const span = Math.max(1, Math.floor(data.length * 0.75));
      const reader = node;
      read = () => {
        reader.getByteFrequencyData(data);
        return Array.from({ length: barCount }, (_, index) => {
          const sample = data[Math.floor((index / barCount) * span)] ?? 0;
          return Math.max(restLevel, sample / 255);
        });
      };
    } else if (pulse) {
      read = () => {
        const t = performance.now() / 1000;
        return Array.from({ length: barCount }, (_, index) => {
          const wave = (Math.sin(t * 3 - index * 0.45) + 1) / 2;
          return restLevel + wave * 0.28;
        });
      };
    } else {
      return;
    }

    const tick = () => {
      if (read) setLevels(read());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      cleanup();
      setLevels(rest());
    };
  }, [analyser, pulse, reduceMotion, stream]);

  const moving = live || pulse;
  const bars = reduceMotion
    ? moving
      ? [0.35, 0.7, 0.5, 0.4]
      : [0.15, 0.15, 0.15, 0.15]
    : moving
      ? levels
      : rest();

  return (
    <div
      aria-hidden
      className={cn(
        "flex h-8 w-full max-w-xs items-center justify-center",
        reduceMotion ? "gap-1" : "gap-0.5",
        className,
      )}
    >
      {bars.map((level, index) => (
        <span
          className={cn(
            "w-0.5 rounded-full transition-[height] duration-75",
            live ? "bg-foreground" : "bg-muted-foreground/60",
          )}
          key={index}
          style={{ height: `${Math.round(level * 100)}%` }}
        />
      ))}
    </div>
  );
}
