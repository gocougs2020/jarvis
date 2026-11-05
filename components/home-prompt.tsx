"use client";

import type { ChatStatus } from "ai";
import { ArrowUpIcon, CheckIcon, MicIcon, PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { AttachmentGallery } from "@/components/attachment-gallery";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { PromptSkillInput } from "@/components/prompt-skill-input";
import { Spinner } from "@/components/ui/spinner";
import { appConfig } from "@/app.config";
import { cn } from "@/lib/utils";

type VoiceState = "idle" | "listening" | "transcribing";

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return "";
}

function HomeSubmit({
  busy,
  onCancel,
  prompt,
  status,
  submitting,
}: {
  readonly busy?: boolean;
  readonly onCancel?: () => void;
  readonly prompt: string;
  readonly status?: ChatStatus;
  readonly submitting: boolean;
}) {
  const attachments = usePromptInputAttachments();
  const canSubmit = prompt.trim().length > 0 || attachments.files.length > 0;
  const stopOnly = Boolean(busy && !canSubmit);

  return (
    <PromptInputSubmit
      className="rounded-full"
      disabled={submitting || (!canSubmit && !busy)}
      onStop={stopOnly ? onCancel : undefined}
      status={stopOnly ? status : submitting ? "submitted" : undefined}
    >
      {stopOnly ? undefined : <ArrowUpIcon className="size-5" />}
    </PromptInputSubmit>
  );
}

function HomeAttachments() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;

  return (
    <PromptInputHeader className="px-4 pt-3 pb-0">
      <AttachmentGallery files={attachments.files} onRemove={attachments.remove} />
    </PromptInputHeader>
  );
}

function ListeningWaveform({
  paused,
  stream,
}: {
  readonly paused?: boolean;
  readonly stream?: MediaStream;
}) {
  const [levels, setLevels] = useState(() => Array.from({ length: 28 }, () => 0.18));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!stream || paused || reduceMotion) return;
    const context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      setLevels(
        Array.from({ length: 28 }, (_, index) => {
          const sample = data[Math.floor((index / 28) * data.length)] ?? 0;
          return Math.max(0.12, sample / 255);
        }),
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
    };
  }, [paused, reduceMotion, stream]);

  if (reduceMotion) {
    return (
      <div className="flex h-8 w-full max-w-xs items-center justify-center gap-1" aria-hidden>
        {[0.35, 0.7, 0.5, 0.4].map((level, index) => (
          <span
            className="w-0.5 rounded-full bg-foreground"
            key={index}
            style={{ height: `${Math.round(level * 100)}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-8 w-full max-w-xs items-center justify-center gap-0.5" aria-hidden>
      {levels.map((level, index) => (
        <span
          className="w-0.5 rounded-full bg-foreground"
          key={index}
          style={{ height: `${Math.round(level * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function HomePrompt({
  busy,
  onCancel,
  onSubmit,
  placeholder = appConfig.home.promptPlaceholder,
  prompt,
  setPrompt,
  slashMenuPlacement,
  status,
  submitting,
}: {
  readonly busy?: boolean;
  readonly onCancel?: () => void;
  readonly onSubmit: (message: PromptInputMessage) => void;
  readonly placeholder?: string;
  readonly prompt: string;
  readonly setPrompt: (value: string) => void;
  readonly slashMenuPlacement?: "above-input" | "below-slash";
  readonly status?: ChatStatus;
  readonly submitting: boolean;
}) {
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string>();
  const [stream, setStream] = useState<MediaStream>();
  const desktopAutofocus = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(pointer: fine)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(pointer: fine)").matches,
    () => false,
  );
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  // eslint-disable-next-line react-hooks/refs -- keep the latest media stream for cleanup
  streamRef.current = stream;

  const stopStream = (media?: MediaStream) => {
    for (const track of (media ?? streamRef.current)?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = undefined;
    setStream(undefined);
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop();
      }
    };
  }, []);

  const startListening = async () => {
    setVoiceError(undefined);
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
      setStream(media);
      setVoice("listening");
    } catch {
      setVoiceError("Microphone access is required for voice input.");
    }
  };

  const cancelVoice = () => {
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

  const finishVoice = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
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
      return;
    }
    if (blob.size === 0) {
      setVoice("idle");
      setVoiceError("Couldn't capture that recording. Try again.");
      return;
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
      if (text) {
        setPrompt(prompt.trim() ? `${prompt.trim()} ${text}` : text);
      } else {
        setVoiceError("No speech detected. Try again.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setVoiceError("Couldn't transcribe that recording. Try again.");
    } finally {
      setVoice("idle");
    }
  };

  const listening = voice !== "idle";
  const [fileDragDepth, setFileDragDepth] = useState(0);

  useEffect(() => {
    const preventWindowFileOpen = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    };
    const onWindowDrop = (event: globalThis.DragEvent) => {
      preventWindowFileOpen(event);
      setFileDragDepth(0);
    };
    document.addEventListener("dragover", preventWindowFileOpen);
    document.addEventListener("drop", onWindowDrop);
    return () => {
      document.removeEventListener("dragover", preventWindowFileOpen);
      document.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <div className="flex w-full flex-col gap-2">
      <PromptInput
        className={cn(
          "[&_[data-slot=input-group]]:h-auto [&_[data-slot=input-group]]:overflow-visible [&_[data-slot=input-group]]:rounded-[28px] [&_[data-slot=input-group]]:bg-card [&_[data-slot=input-group]]:px-1 [&_[data-slot=input-group]]:pt-0.5 [&_[data-slot=input-group]]:shadow-sm",
          fileDragDepth > 0 &&
            "[&_[data-slot=input-group]]:border-foreground/30 [&_[data-slot=input-group]]:bg-accent/40",
        )}
        multiple
        onDragEnter={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setFileDragDepth((depth) => depth + 1);
        }}
        onDragLeave={(event) => {
          if (!isFileDrag(event)) return;
          setFileDragDepth((depth) => Math.max(0, depth - 1));
        }}
        onDrop={() => setFileDragDepth(0)}
        onSubmit={(message) => {
          if (listening || submitting) return;
          onSubmit(message);
        }}
      >
        <HomeAttachments />
        <PromptInputBody>
          {listening ? (
            <div className="flex min-h-10 flex-row items-center justify-center gap-2 px-5">
              <ListeningWaveform paused={voice === "transcribing"} stream={stream} />
              <p className="text-muted-foreground text-sm" aria-live="polite">
                {voice === "transcribing" ? "Transcribing…" : "Listening…"}
              </p>
            </div>
          ) : (
            <PromptSkillInput
              autoFocus={desktopAutofocus}
              className="min-h-8 px-5 pt-3"
              disabled={submitting}
              onValueChange={setPrompt}
              placeholder={placeholder}
              slashMenuPlacement={slashMenuPlacement}
              value={prompt}
            />
          )}
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {listening ? (
              <PromptInputButton aria-label="Cancel recording" onClick={cancelVoice}>
                <XIcon />
              </PromptInputButton>
            ) : (
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger aria-label="Attach files">
                  <PlusIcon className="size-5" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                  <PromptInputActionAddScreenshot />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
            )}
          </PromptInputTools>
          <div className="flex items-center gap-3">
            {listening ? (
              <PromptInputButton
                aria-label={voice === "transcribing" ? "Transcribing" : "Finish recording"}
                className="rounded-full"
                disabled={voice === "transcribing"}
                variant="default"
                onClick={() => void finishVoice()}
              >
                {voice === "transcribing" ? <Spinner /> : <CheckIcon />}
              </PromptInputButton>
            ) : (
              <>
                <PromptInputButton
                  aria-label="Start voice input"
                  disabled={submitting}
                  onClick={() => void startListening()}
                >
                  <MicIcon className="size-5" />
                </PromptInputButton>
                <HomeSubmit
                  busy={busy}
                  onCancel={onCancel}
                  prompt={prompt}
                  status={status}
                  submitting={submitting}
                />
              </>
            )}
          </div>
        </PromptInputFooter>
      </PromptInput>
      {voiceError ? (
        <p className="text-center text-destructive text-xs" role="alert">
          {voiceError}
        </p>
      ) : null}
    </div>
  );
}
