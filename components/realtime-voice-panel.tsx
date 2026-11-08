"use client";

import { experimental_useRealtime as useRealtime } from "@ai-sdk/react";
import { gateway } from "ai";
import { MicIcon, MicOffIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { appConfig } from "@/app.config";
import { Button } from "@/components/ui/button";
import { VoiceWaveform } from "@/components/voice-waveform";

type Phase =
  | "connecting"
  | "listening"
  | "speaking"
  | "muted"
  | "ended"
  | "error";

const phaseLabel: Record<Phase, string> = {
  connecting: "Connecting…",
  ended: "Voice session ended. Tap the mic to talk again.",
  error: "Voice mode could not connect. Tap the mic to try again.",
  listening: "Listening…",
  muted: "Muted",
  speaking: "Speaking…",
};

const realtimeModel = gateway.experimental_realtime(appConfig.models.realtime);

const micConstraints: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true,
  },
};

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access is blocked. Allow it in your browser settings, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one, then try again.";
  }
  return "Could not open the microphone. Check your browser settings, then try again.";
}

/**
 * Hands-free voice: a realtime speech-to-speech session with
 * `models.realtime` over AI Gateway. Audio streams both ways over a
 * WebSocket, the model detects turns itself, and talking over a reply
 * interrupts it. This runs outside the eve agent: no transcript is posted to
 * the chat and the model has no tools.
 */
export function RealtimeVoicePanel({ onEnd }: { readonly onEnd: () => void }) {
  const [attempt, setAttempt] = useState(0);
  const [instructions, setInstructions] = useState<string>();
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    try {
      params.set("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone);
      params.set("locale", navigator.language);
    } catch {
      // The server falls back to UTC and en-US.
    }
    fetch(`/api/realtime?${params}`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok)
          throw new Error(`Voice setup failed (${response.status}).`);
        return response.json() as Promise<{ instructions?: string }>;
      })
      .then((body) => {
        if (!cancelled) setInstructions(body.instructions ?? "");
      })
      .catch((error: unknown) => {
        console.warn("[voice] could not load instructions", error);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  if (loadError) {
    return (
      <VoiceShell
        label={phaseLabel.error}
        onEnd={onEnd}
        onMic={() => {
          setLoadError(false);
          setLoadAttempt((value) => value + 1);
        }}
      />
    );
  }
  if (instructions === undefined) {
    return <VoiceShell label={phaseLabel.connecting} onEnd={onEnd} pulse />;
  }
  return (
    <RealtimeSession
      instructions={instructions}
      key={attempt}
      onEnd={onEnd}
      onRestart={() => setAttempt((value) => value + 1)}
    />
  );
}

function RealtimeSession({
  instructions,
  onEnd,
  onRestart,
}: {
  readonly instructions: string;
  readonly onEnd: () => void;
  readonly onRestart: () => void;
}) {
  const sessionConfig = useMemo(
    () => ({
      instructions,
      outputModalities: ["audio" as const],
      turnDetection: { type: "server-vad" as const },
      voice: appConfig.voice.realtimeVoice,
    }),
    [instructions],
  );
  const [stream, setStream] = useState<MediaStream>();
  const [micError, setMicError] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [wasConnected, setWasConnected] = useState(false);
  const realtime = useRealtime({
    api: { token: "/api/realtime" },
    model: realtimeModel,
    onError: (error) => console.warn("[voice] realtime error", error),
    sessionConfig,
  });
  const {
    connect,
    disconnect,
    isCapturing,
    isPlaying,
    startAudioCapture,
    status,
    stopAudioCapture,
  } = realtime;
  const connectRef = useRef(connect);
  const disconnectRef = useRef(disconnect);
  useEffect(() => {
    connectRef.current = connect;
    disconnectRef.current = disconnect;
  });

  // Open the mic and the session together, so the first words are not lost.
  useEffect(() => {
    let cancelled = false;
    let local: MediaStream | undefined;
    void (async () => {
      try {
        local = await navigator.mediaDevices.getUserMedia(micConstraints);
      } catch (error) {
        if (!cancelled) setMicError(micErrorMessage(error));
        return;
      }
      if (cancelled) {
        for (const track of local.getTracks()) track.stop();
        return;
      }
      setStream(local);
      await connectRef.current();
    })();
    return () => {
      cancelled = true;
      disconnectRef.current();
      for (const track of local?.getTracks() ?? []) track.stop();
    };
  }, []);

  if (status === "connected" && !wasConnected) setWasConnected(true);

  // Stream mic audio once the session is ready. Capture stops the stream's
  // tracks, so a mute keeps the session and unmuting needs a fresh stream.
  useEffect(() => {
    if (status !== "connected" || !stream || muted || isCapturing) return;
    if (stream.getAudioTracks().some((track) => track.readyState === "live")) {
      startAudioCapture(stream);
      return;
    }
    let cancelled = false;
    void navigator.mediaDevices.getUserMedia(micConstraints).then(
      (fresh) => {
        if (cancelled) {
          for (const track of fresh.getTracks()) track.stop();
          return;
        }
        setStream(fresh);
      },
      (error: unknown) => {
        if (!cancelled) setMicError(micErrorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isCapturing, muted, startAudioCapture, status, stream]);

  const phase: Phase =
    status === "error"
      ? "error"
      : status === "disconnected" && wasConnected
        ? "ended"
        : status !== "connected"
          ? "connecting"
          : isPlaying
            ? "speaking"
            : muted
              ? "muted"
              : "listening";

  const live = phase === "listening" && isCapturing;
  const finished = phase === "ended" || phase === "error";

  return (
    <VoiceShell
      error={micError}
      label={phaseLabel[phase]}
      micLabel={finished ? "Start talking" : muted ? "Unmute" : "Mute"}
      muted={muted && !finished}
      onEnd={onEnd}
      onMic={
        micError
          ? undefined
          : finished
            ? onRestart
            : () => {
                if (muted) {
                  setMuted(false);
                } else {
                  setMuted(true);
                  stopAudioCapture();
                }
              }
      }
      pulse={phase === "connecting" || phase === "speaking"}
      stream={live ? stream : undefined}
    />
  );
}

function VoiceShell({
  error,
  label,
  micLabel = "Start talking",
  muted,
  onEnd,
  onMic,
  pulse,
  stream,
}: {
  readonly error?: string;
  readonly label: string;
  readonly micLabel?: string;
  readonly muted?: boolean;
  readonly onEnd: () => void;
  readonly onMic?: () => void;
  readonly pulse?: boolean;
  readonly stream?: MediaStream;
}) {
  return (
    <div className="flex w-full flex-col gap-1 px-1 pt-3 pb-1">
      <div className="flex min-h-16 flex-col items-center justify-center gap-1 px-4">
        <VoiceWaveform pulse={pulse} stream={stream} />
        <p
          aria-live="polite"
          className="text-center text-muted-foreground text-sm"
        >
          {error ?? label}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <Button
          aria-label="End voice mode"
          className="rounded-full"
          size="sm"
          type="button"
          variant="ghost"
          onClick={onEnd}
        >
          <XIcon />
          <span>End voice</span>
        </Button>
        <Button
          aria-label={micLabel}
          aria-pressed={muted}
          className="rounded-full [&_svg:not([class*='size-'])]:size-5"
          disabled={!onMic}
          size="icon"
          type="button"
          variant={muted ? "secondary" : "default"}
          onClick={onMic}
        >
          {muted ? <MicOffIcon /> : <MicIcon />}
        </Button>
      </div>
    </div>
  );
}
