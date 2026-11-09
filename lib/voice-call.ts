"use client";

import { gateway } from "ai";
import { appConfig } from "@/app.config";
import { getVoiceAudioContext } from "./voice-audio";
import {
  decodePcm16,
  encodePcm16,
  REALTIME_SAMPLE_RATE,
  reduceTranscript,
  resample,
  type TranscriptEvent,
  type VoiceTurn,
} from "./voice-call-logic";

/**
 * connecting → listening ⇄ hearing (user talking) → waiting (model is
 * preparing a reply) → speaking (reply playing) → listening …
 */
export type VoiceCallPhase =
  | "connecting"
  | "listening"
  | "hearing"
  | "waiting"
  | "speaking"
  | "ended"
  | "error";

export type VoiceCallSnapshot = {
  readonly phase: VoiceCallPhase;
  readonly muted: boolean;
  readonly turns: readonly VoiceTurn[];
  /** Why the call failed or ended, in words for the user. */
  readonly message?: string;
};

type SetupResponse = {
  readonly token?: string;
  readonly url?: string;
  readonly instructions?: string;
  readonly error?: string;
};

/** A normalized AI SDK realtime server event, as the Gateway sends it. */
type ServerEvent = { readonly type: string; readonly [key: string]: unknown };

const CONNECT_TIMEOUT_MS = 15_000;
const WORKLET_URL = "/voice-capture-worklet.js";
const workletLoads = new WeakMap<BaseAudioContext, Promise<void>>();

const micConstraints: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  },
};

class VoiceCallError extends Error {}

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access is blocked. Allow it in your browser settings, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one, then try again.";
  }
  return "Could not open the microphone. Check your browser settings, then try again.";
}

function loadWorklet(context: AudioContext): Promise<void> {
  let load = workletLoads.get(context);
  if (!load) {
    load = context.audioWorklet.addModule(WORKLET_URL);
    workletLoads.set(context, load);
    load.catch(() => workletLoads.delete(context));
  }
  return load;
}

async function fetchSetup(): Promise<{
  token: string;
  url: string;
  instructions: string;
}> {
  let timeZone: string | undefined;
  let locale: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    locale = navigator.language;
  } catch {
    // The server falls back to UTC and en-US.
  }
  const response = await fetch("/api/realtime", {
    body: JSON.stringify({ locale, timeZone }),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }).catch(() => {
    throw new VoiceCallError("You appear to be offline. Check your connection, then try again.");
  });
  const body = (await response.json().catch(() => ({}))) as SetupResponse;
  if (!response.ok || !body.token || !body.url) {
    throw new VoiceCallError(
      body.error ?? `Voice mode could not start (${response.status}).`,
    );
  }
  return { instructions: body.instructions ?? "", token: body.token, url: body.url };
}

function closeReason(event: CloseEvent): string {
  const reason = event.reason?.trim();
  if (reason) return reason;
  if (event.code === 1006) return "the connection dropped";
  return `connection closed (${event.code})`;
}

/**
 * One voice-mode call: the mic and speaker talking to `models.realtime` over
 * an AI Gateway WebSocket, entirely outside the eve agent. Exposes analysers
 * for both sides so the screen can draw who is talking, plus a live
 * transcript. `start` can be called again after `stop` (or a failure) to
 * reconnect; the transcript is kept.
 */
export class VoiceCall {
  micAnalyser: AnalyserNode | undefined;
  agentAnalyser: AnalyserNode | undefined;

  private snapshot: VoiceCallSnapshot = {
    muted: false,
    phase: "connecting",
    turns: [],
  };
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  private context: AudioContext | undefined;
  private ws: WebSocket | undefined;
  private stream: MediaStream | undefined;
  private micSource: MediaStreamAudioSourceNode | undefined;
  private capture: AudioWorkletNode | undefined;
  private sink: GainNode | undefined;
  private agentOut: GainNode | undefined;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;
  private replyItemId: string | undefined;
  private replyStartedAt = 0;
  private lastServerError: string | undefined;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private update(patch: Partial<VoiceCallSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setPhase(phase: VoiceCallPhase) {
    if (this.snapshot.phase !== phase) this.update({ phase });
  }

  private live() {
    const { phase } = this.snapshot;
    return phase !== "connecting" && phase !== "ended" && phase !== "error";
  }

  async start(): Promise<void> {
    this.teardown();
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.lastServerError = undefined;
    this.update({ message: undefined, phase: "connecting" });

    const context = getVoiceAudioContext();
    if (!context) {
      this.fail("This browser cannot play voice audio.");
      return;
    }
    this.context = context;
    if (context.state === "suspended") void context.resume().catch(() => undefined);

    // Mic, token + instructions, and the capture worklet load in parallel.
    const micPromise = navigator.mediaDevices
      .getUserMedia(micConstraints)
      .catch((error: unknown) => {
        throw new VoiceCallError(micErrorMessage(error));
      });
    let stream: MediaStream | undefined;
    let setup: Awaited<ReturnType<typeof fetchSetup>>;
    try {
      [stream, setup] = await Promise.all([
        micPromise,
        fetchSetup(),
        loadWorklet(context).catch(() => {
          throw new VoiceCallError("This browser cannot capture voice audio.");
        }),
      ]);
    } catch (error) {
      void micPromise.then(
        (mic) => {
          for (const track of mic.getTracks()) track.stop();
        },
        () => undefined,
      );
      if (current()) {
        console.warn("[voice] setup failed", error);
        this.fail(
          error instanceof VoiceCallError
            ? error.message
            : "Voice mode could not start. Try again.",
        );
      }
      return;
    }
    if (!current()) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }

    this.stream = stream;
    for (const track of stream.getAudioTracks())
      track.enabled = !this.snapshot.muted;
    this.buildGraph(context, stream);

    const { protocols, url } = gateway
      .experimental_realtime(appConfig.models.realtime)
      .getWebSocketConfig({ token: setup.token, url: setup.url });
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, protocols);
    } catch (error) {
      console.warn("[voice] websocket failed", error);
      this.fail("Voice mode could not reach the voice service.");
      return;
    }
    this.ws = ws;
    let opened = false;

    this.connectTimer = setTimeout(() => {
      if (!current() || opened) return;
      this.fail("Voice mode took too long to connect. Try again.");
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      if (!current()) return;
      opened = true;
      clearTimeout(this.connectTimer);
      this.send({
        type: "session-update",
        config: {
          inputAudioFormat: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
          inputAudioTranscription: {},
          instructions: setup.instructions,
          outputAudioFormat: { type: "audio/pcm", rate: REALTIME_SAMPLE_RATE },
          outputAudioTranscription: {},
          outputModalities: ["audio"],
          turnDetection: { type: "server-vad" },
          voice: appConfig.voice.realtimeVoice,
        },
      });
      this.setPhase("listening");
    };
    ws.onmessage = (message) => {
      if (!current() || typeof message.data !== "string") return;
      let event: ServerEvent;
      try {
        event = JSON.parse(message.data) as ServerEvent;
      } catch {
        return;
      }
      this.handleEvent(event);
    };
    ws.onerror = () => {
      if (current()) console.warn("[voice] websocket error");
    };
    ws.onclose = (event) => {
      if (!current()) return;
      this.ws = undefined;
      const detail = this.lastServerError ?? closeReason(event);
      if (!opened) {
        this.fail(`Voice mode could not connect: ${detail}.`);
        return;
      }
      this.releaseMedia();
      const clean = event.code === 1000 && !this.lastServerError;
      this.update({
        message: clean
          ? "The voice session ended."
          : `The voice session ended: ${detail}.`,
        phase: clean ? "ended" : "error",
      });
    };
  }

  /** Hang up. Safe to call more than once. */
  stop(): void {
    this.generation++;
    this.teardown();
    if (this.live() || this.snapshot.phase === "connecting")
      this.update({ phase: "ended", message: undefined });
  }

  setMuted(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !muted;
    this.update({ muted });
  }

  /** Stop the reply that is playing, as if the user had talked over it. */
  interrupt(): void {
    if (this.sources.size === 0) return;
    this.cutReply();
    this.send({ type: "response-cancel" });
    this.setPhase("listening");
  }

  private fail(message: string) {
    this.generation++;
    this.teardown();
    this.update({ message, phase: "error" });
  }

  private send(event: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(event));
  }

  private buildGraph(context: AudioContext, stream: MediaStream) {
    const source = context.createMediaStreamSource(stream);
    const micAnalyser = context.createAnalyser();
    micAnalyser.fftSize = 64;
    source.connect(micAnalyser);

    const capture = new AudioWorkletNode(context, "voice-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    // A silent sink keeps the worklet pulled by the graph in every browser.
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(capture);
    capture.connect(sink);
    sink.connect(context.destination);
    capture.port.onmessage = (message: MessageEvent<Float32Array>) => {
      if (this.snapshot.muted || !this.live()) return;
      const samples = resample(message.data, context.sampleRate, REALTIME_SAMPLE_RATE);
      this.send({ type: "input-audio-append", audio: encodePcm16(samples) });
    };

    const agentOut = context.createGain();
    const agentAnalyser = context.createAnalyser();
    agentAnalyser.fftSize = 64;
    agentOut.connect(agentAnalyser);
    agentAnalyser.connect(context.destination);

    this.micSource = source;
    this.capture = capture;
    this.sink = sink;
    this.agentOut = agentOut;
    this.micAnalyser = micAnalyser;
    this.agentAnalyser = agentAnalyser;
    this.playhead = context.currentTime;
  }

  private handleEvent(event: ServerEvent) {
    switch (event.type) {
      case "speech-started":
        // Talking over a reply cuts it off, like on a phone call.
        if (this.sources.size > 0) this.cutReply();
        this.setPhase("hearing");
        break;
      case "speech-stopped":
        if (this.snapshot.phase === "hearing") this.setPhase("waiting");
        break;
      case "audio-delta":
        this.play(event);
        break;
      case "response-done":
        if (this.sources.size === 0 && this.snapshot.phase !== "hearing")
          this.setPhase("listening");
        break;
      case "error": {
        const message =
          typeof event.message === "string" && event.message.trim()
            ? event.message.trim()
            : "the voice service reported an error";
        console.warn("[voice] server error", event);
        this.lastServerError = message;
        break;
      }
    }
    const turns = reduceTranscript(this.snapshot.turns, event as TranscriptEvent);
    if (turns !== this.snapshot.turns) this.update({ turns });
  }

  private play(event: ServerEvent) {
    const context = this.context;
    const out = this.agentOut;
    const delta = typeof event.delta === "string" ? event.delta : undefined;
    const itemId = typeof event.itemId === "string" ? event.itemId : undefined;
    if (!context || !out || !delta) return;
    const samples = decodePcm16(delta);
    if (samples.length === 0) return;
    const buffer = context.createBuffer(1, samples.length, REALTIME_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    const startAt = Math.max(this.playhead, context.currentTime + 0.02);
    if (itemId !== this.replyItemId) {
      this.replyItemId = itemId;
      this.replyStartedAt = startAt;
    }
    source.start(startAt);
    this.playhead = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      if (this.sources.size === 0 && this.snapshot.phase === "speaking")
        this.setPhase("listening");
    };
    this.setPhase("speaking");
  }

  private cutReply() {
    const context = this.context;
    const playedMs = context
      ? Math.max(0, Math.round((context.currentTime - this.replyStartedAt) * 1000))
      : 0;
    this.stopPlayback();
    if (this.replyItemId) {
      this.send({
        type: "conversation-item-truncate",
        audioEndMs: playedMs,
        contentIndex: 0,
        itemId: this.replyItemId,
      });
    }
  }

  private stopPlayback() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
    }
    this.sources.clear();
    if (this.context) this.playhead = this.context.currentTime;
  }

  private releaseMedia() {
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.disconnect();
    }
    this.micSource?.disconnect();
    this.sink?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.capture = undefined;
    this.micSource = undefined;
    this.sink = undefined;
    this.stream = undefined;
    this.micAnalyser = undefined;
  }

  private teardown() {
    clearTimeout(this.connectTimer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
        ws.close(1000);
    }
    this.stopPlayback();
    this.releaseMedia();
    this.agentOut?.disconnect();
    this.agentAnalyser?.disconnect();
    this.agentOut = undefined;
    this.agentAnalyser = undefined;
    this.replyItemId = undefined;
  }
}
