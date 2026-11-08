"use client";

import type { ChatStatus } from "ai";
import {
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  MicIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
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
import { RealtimeVoicePanel } from "@/components/realtime-voice-panel";
import { Spinner } from "@/components/ui/spinner";
import { VoiceWaveform } from "@/components/voice-waveform";
import { appConfig } from "@/app.config";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { cn } from "@/lib/utils";
import { primeVoiceAudio } from "@/lib/voice-audio";

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
      <AttachmentGallery
        files={attachments.files}
        onRemove={attachments.remove}
      />
    </PromptInputHeader>
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
  const recording = useVoiceRecording();
  const { stream, voice } = recording;
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceError = recording.error;
  const desktopAutofocus = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(pointer: fine)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(pointer: fine)").matches,
    () => false,
  );

  const startListening = async () => {
    // Priming inside the tap lets the waveform analyse the mic, including on Safari.
    primeVoiceAudio();
    return recording.start();
  };

  const finishVoice = async () => {
    const text = await recording.finish();
    if (!text) return;
    const current = prompt.trim();
    setPrompt(current ? `${current} ${text}` : text);
  };

  const openVoiceMode = () => {
    // Voice mode is its own realtime session, separate from this chat.
    recording.cancel();
    primeVoiceAudio();
    setVoiceMode(true);
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

  const isFileDrag = (event: DragEvent) =>
    event.dataTransfer.types.includes("Files");

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
          {voiceMode ? (
            <RealtimeVoicePanel onEnd={() => setVoiceMode(false)} />
          ) : listening ? (
            <div className="flex min-h-10 flex-row items-center justify-center gap-2 px-5">
              <VoiceWaveform
                pulse={voice === "transcribing"}
                stream={voice === "listening" ? stream : undefined}
              />
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
        {voiceMode ? null : (
          <PromptInputFooter>
            <PromptInputTools>
              {listening ? (
                <PromptInputButton
                  aria-label="Cancel recording"
                  onClick={recording.cancel}
                >
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
                  aria-label={
                    voice === "transcribing"
                      ? "Transcribing"
                      : "Finish recording"
                  }
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
                    aria-label="Turn on voice mode"
                    disabled={submitting}
                    tooltip="Voice mode: talk with the assistant in real time"
                    onClick={openVoiceMode}
                  >
                    <AudioLinesIcon className="size-5" />
                  </PromptInputButton>
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
        )}
      </PromptInput>
      {voiceError ? (
        <p className="text-center text-destructive text-xs" role="alert">
          {voiceError}
        </p>
      ) : null}
    </div>
  );
}
