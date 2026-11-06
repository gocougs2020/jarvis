"use client";

import type { ChatStatus } from "ai";
import { ArrowUpIcon, AudioLinesIcon, CheckIcon, MicIcon, PlusIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
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
import { Spinner } from "@/components/ui/spinner";
import { VoiceWaveform } from "@/components/voice-waveform";
import { appConfig } from "@/app.config";
import { useVoiceActivity } from "@/hooks/use-voice-activity";
import { useVoiceRecording } from "@/hooks/use-voice-recording";
import { cn } from "@/lib/utils";
import {
  getSpeechAnalyser,
  getVoiceSession,
  primeVoiceAudio,
  setVoiceLoop,
  setVoiceMode,
  stopSpeaking,
  useVoiceSession,
} from "@/lib/voice-mode";

/** What the hands-free voice panel is showing. */
type VoicePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

const voicePhaseLabel: Record<VoicePhase, string> = {
  idle: "Tap the mic to talk",
  listening: "Listening…",
  speaking: "Speaking…",
  thinking: "Thinking…",
  transcribing: "Transcribing…",
};

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

function VoicePanel({ phase, stream }: { readonly phase: VoicePhase; readonly stream?: MediaStream }) {
  return (
    <div className="flex min-h-16 flex-col items-center justify-center gap-1 px-5 pt-3 pb-1">
      <VoiceWaveform
        analyser={phase === "speaking" ? getSpeechAnalyser() : undefined}
        pulse={phase === "thinking" || phase === "transcribing" || phase === "speaking"}
        stream={phase === "listening" ? stream : undefined}
      />
      <p aria-live="polite" className="text-muted-foreground text-sm">
        {voicePhaseLabel[phase]}
      </p>
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
  const recording = useVoiceRecording();
  const { stream, voice } = recording;
  const voiceSession = useVoiceSession();
  const voiceMode = voiceSession.on;
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
  const promptRef = useRef(prompt);
  const submittingRef = useRef(submitting);
  const startRecordingRef = useRef(recording.start);
  const cancelRecordingRef = useRef(recording.cancel);
  useEffect(() => {
    promptRef.current = prompt;
    submittingRef.current = submitting;
    startRecordingRef.current = recording.start;
    cancelRecordingRef.current = recording.cancel;
  });
  const turnActive = Boolean(busy || submitting);

  const startListening = useCallback(async () => {
    // Talking over a spoken reply interrupts it. Priming here (inside the tap)
    // lets later replies play and the mic be analysed, including on Safari.
    stopSpeaking();
    primeVoiceAudio();
    return startRecordingRef.current();
  }, []);

  const finishVoice = async () => {
    const text = await recording.finish();
    if (!text) {
      // Nothing usable: in voice mode, wait for a tap instead of looping.
      if (getVoiceSession().on) setVoiceLoop("idle");
      return;
    }
    const current = promptRef.current.trim();
    const combined = current ? `${current} ${text}` : text;
    if (getVoiceSession().on && !submittingRef.current) {
      // Hands-free: send the transcript straight away; the reply is spoken
      // and the composer listens again once it finishes.
      setPrompt("");
      setVoiceLoop("sent");
      onSubmit({ files: [], text: combined });
    } else {
      setPrompt(combined);
    }
  };

  // Hands-free: send when the speaker goes quiet, stop when nobody speaks.
  useVoiceActivity({
    enabled: voiceMode && voice === "listening",
    stream,
    onResult: (result) => {
      if (result === "no-speech") {
        recording.cancel();
        setVoiceLoop("idle");
        return;
      }
      void finishVoice();
    },
  });

  // Hands-free loop: once the sent turn has started, and both the turn and
  // its spoken reply are done, listen again.
  const { loop, speech } = voiceSession;
  useEffect(() => {
    if (!voiceMode) return;
    if (loop === "sent") {
      if (turnActive || speech !== "idle") {
        setVoiceLoop("replying");
        return;
      }
      // The send never started a turn (e.g. it was rejected): stop waiting.
      const timer = window.setTimeout(() => {
        if (getVoiceSession().loop === "sent") setVoiceLoop("idle");
      }, 10_000);
      return () => window.clearTimeout(timer);
    }
    if (loop !== "replying" || turnActive || speech !== "idle" || voice !== "idle") return;
    // Short grace period: the reply's speech request starts just after the
    // turn settles, and a quick answer can hand over to a full agent turn.
    const timer = window.setTimeout(() => {
      const session = getVoiceSession();
      if (!session.on || session.loop !== "replying" || session.speech !== "idle") return;
      // Clear the loop only once the mic is live, so the panel goes straight
      // from "Thinking…" to "Listening…".
      void startListening().then((ok) => {
        // Voice mode was ended while the mic was opening: close it again.
        if (ok && !getVoiceSession().on) cancelRecordingRef.current();
        setVoiceLoop("idle");
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [loop, speech, startListening, turnActive, voice, voiceMode]);

  const toggleVoiceMode = () => {
    if (voiceMode) {
      recording.cancel();
      setVoiceMode(false);
      return;
    }
    setVoiceMode(true);
    if (turnActive) {
      // A turn is already running: speak its reply, then start listening.
      primeVoiceAudio();
      setVoiceLoop("replying");
      return;
    }
    void startListening().then((ok) => {
      if (!ok) setVoiceMode(false);
      else if (!getVoiceSession().on) cancelRecordingRef.current();
    });
  };

  const voicePhase: VoicePhase =
    voice === "listening"
      ? "listening"
      : voice === "transcribing"
        ? "transcribing"
        : speech === "playing"
          ? "speaking"
          : turnActive || speech === "loading" || loop !== "idle"
            ? "thinking"
            : "idle";

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
          {voiceMode ? (
            <VoicePanel phase={voicePhase} stream={stream} />
          ) : listening ? (
            <div className="flex min-h-10 flex-row items-center justify-center gap-2 px-5">
              <VoiceWaveform pulse={voice === "transcribing"} stream={voice === "listening" ? stream : undefined} />
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
            {voiceMode ? (
              <PromptInputButton aria-label="End voice mode" onClick={toggleVoiceMode}>
                <XIcon />
                <span>End voice</span>
              </PromptInputButton>
            ) : listening ? (
              <PromptInputButton aria-label="Cancel recording" onClick={recording.cancel}>
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
                  voice === "transcribing" ? "Transcribing" : voiceMode ? "Send now" : "Finish recording"
                }
                className="rounded-full"
                disabled={voice === "transcribing"}
                variant="default"
                onClick={() => void finishVoice()}
              >
                {voice === "transcribing" ? <Spinner /> : <CheckIcon />}
              </PromptInputButton>
            ) : voiceMode && turnActive ? (
              <HomeSubmit
                busy={busy}
                onCancel={onCancel}
                prompt=""
                status={status}
                submitting={submitting}
              />
            ) : voiceMode ? (
              <PromptInputButton
                aria-label={voicePhase === "speaking" ? "Interrupt and talk" : "Start talking"}
                className="rounded-full"
                variant="default"
                onClick={() => {
                  setVoiceLoop("idle");
                  void startListening();
                }}
              >
                <MicIcon className="size-5" />
              </PromptInputButton>
            ) : (
              <>
                <PromptInputButton
                  aria-label="Turn on voice mode"
                  disabled={submitting}
                  tooltip="Voice mode: talk hands-free and hear replies"
                  onClick={toggleVoiceMode}
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
      </PromptInput>
      {voiceError ? (
        <p className="text-center text-destructive text-xs" role="alert">
          {voiceError}
        </p>
      ) : null}
    </div>
  );
}
