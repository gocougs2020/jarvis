"use client";

import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { VoiceWaveform } from "@/components/voice-waveform";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { primeVoiceAudio } from "@/lib/voice-audio";
import { VoiceCall, type VoiceCallSnapshot } from "@/lib/voice-call";
import type { VoiceTurn } from "@/lib/voice-call-logic";

function statusText({ message, muted, phase }: VoiceCallSnapshot): string {
  switch (phase) {
    case "connecting":
      return "Connecting…";
    case "listening":
      return muted ? "Muted. Tap the mic to talk." : "Listening";
    case "hearing":
      return "Listening…";
    case "waiting":
      return "Replying…";
    case "speaking":
      return `${APP_NAME} is talking. Talk over it to interrupt.`;
    case "ended":
      return message ?? "Call ended.";
    case "error":
      return message ?? "Voice mode stopped. Try again.";
  }
}

/**
 * Voice mode as its own full-screen call: a live transcript, a waveform for
 * each side, and call controls. It talks to `models.realtime` directly from
 * the browser (`lib/voice-call.ts`) and never touches the eve agent or the
 * chat it was opened from.
 */
export function VoiceConversation({ onClose }: { readonly onClose: () => void }) {
  const [call] = useState(() => new VoiceCall());
  const snapshot = useSyncExternalStore(
    call.subscribe,
    call.getSnapshot,
    call.getSnapshot,
  );
  const { muted, phase, turns } = snapshot;
  const finished = phase === "ended" || phase === "error";
  const live = !finished && phase !== "connecting";

  useEffect(() => {
    void call.start();
    return () => call.stop();
  }, [call]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns]);

  const restart = () => {
    primeVoiceAudio();
    void call.start();
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 pt-4 pb-2 sm:px-6">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-medium text-base">
                Voice with {APP_NAME}
              </DialogPrimitive.Title>
              <p
                aria-live="polite"
                className={cn(
                  "truncate text-sm",
                  phase === "error" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {statusText(snapshot)}
              </p>
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                aria-label="Close voice mode"
                className="rounded-full"
                size="icon"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto" ref={scroller}>
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-end px-4 py-4 sm:px-6">
              {turns.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                  <p className="text-lg">
                    {finished ? "Nothing was said." : `Say hello to ${APP_NAME}.`}
                  </p>
                  <p className="max-w-sm text-muted-foreground text-sm">
                    Voice mode is a quick conversation. It can&apos;t use your
                    email, calendar, files, or reminders; type those in the chat.
                  </p>
                </div>
              ) : (
                <ol aria-label="Conversation" className="flex flex-col gap-3">
                  {turns.map((turn) => (
                    <TurnBubble key={turn.id} turn={turn} />
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="mx-auto w-full max-w-2xl px-4 pt-2 pb-6 sm:px-6">
            <div className="flex flex-col gap-3 rounded-[28px] border bg-card p-4 shadow-sm">
              <SpeakerLane
                active={phase === "speaking"}
                analyser={phase === "speaking" ? call.agentAnalyser : undefined}
                barClassName="bg-primary"
                label={APP_NAME}
                pulse={phase === "connecting" || phase === "waiting"}
              />
              <SpeakerLane
                active={phase === "hearing"}
                analyser={live && !muted ? call.micAnalyser : undefined}
                label={muted && live ? "You (muted)" : "You"}
              />
              <div className="flex items-center justify-center gap-3 pt-1">
                {finished ? (
                  <>
                    <Button
                      className="rounded-full"
                      size="lg"
                      type="button"
                      onClick={restart}
                    >
                      <RotateCcwIcon />
                      Talk again
                    </Button>
                    <Button
                      className="rounded-full"
                      size="lg"
                      type="button"
                      variant="ghost"
                      onClick={onClose}
                    >
                      Close
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      aria-label={muted ? "Unmute" : "Mute"}
                      aria-pressed={muted}
                      className="size-12 rounded-full [&_svg:not([class*='size-'])]:size-5"
                      disabled={!live}
                      type="button"
                      variant={muted ? "default" : "secondary"}
                      onClick={() => call.setMuted(!muted)}
                    >
                      {muted ? <MicOffIcon /> : <MicIcon />}
                    </Button>
                    <Button
                      aria-label="End voice mode"
                      className="h-12 rounded-full px-5"
                      type="button"
                      variant="destructive"
                      onClick={onClose}
                    >
                      <PhoneOffIcon />
                      End
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SpeakerLane({
  active,
  analyser,
  barClassName,
  label,
  pulse,
}: {
  readonly active: boolean;
  readonly analyser?: AnalyserNode;
  readonly barClassName?: string;
  readonly label: string;
  readonly pulse?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl px-3 py-1.5 transition-colors",
        active ? "bg-accent" : "bg-transparent",
      )}
    >
      <span
        className={cn(
          "w-20 shrink-0 truncate text-sm",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <VoiceWaveform
        analyser={analyser}
        barClassName={barClassName}
        className="h-9 max-w-none flex-1"
        mirror
        pulse={pulse}
      />
    </div>
  );
}

function TurnBubble({ turn }: { readonly turn: VoiceTurn }) {
  if (turn.role === "user") {
    return (
      <li className="ml-auto max-w-[min(92%,36rem)] rounded-2xl bg-foreground/[0.055] px-3.5 py-2.5 ring-1 ring-foreground/10">
        {turn.text ? (
          turn.text
        ) : (
          <span className="animate-pulse text-muted-foreground">…</span>
        )}
      </li>
    );
  }
  return (
    <li className={cn("max-w-[min(92%,36rem)]", !turn.final && "text-foreground/80")}>
      {turn.text}
    </li>
  );
}
