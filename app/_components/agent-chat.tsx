"use client";

import type { ChatStatus, FileUIPart, UserContent } from "ai";
import type { ClientSessionState, MessageStreamEvent } from "eve/client";
import { useEveAgent } from "eve/react";
import { AlertCircleIcon, ArrowLeftIcon, BrainIcon, FileTextIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  Conversation,
  ConversationContent,
  ConversationDownload,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { SessionContextPopover } from "@/components/session-context-popover";
import { Message, MessageContent } from "@/components/ai-elements/message";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { SessionMessagesLoading } from "@/components/app-route-loading";
import { AppHeader } from "@/components/app-header";
import { BrandHero } from "@/components/brand-hero";
import { HomePrompt } from "@/components/home-prompt";
import { appConfig } from "@/app.config";
import { compactStreamEvents, firstChangedIndex } from "@/lib/chat-event-compaction";
import { isVoiceModeOn, speakText } from "@/lib/voice-mode";
import { SessionDocumentCanvas } from "@/components/session-document-canvas";
import { SessionEmptyCanvas } from "@/components/session-empty-canvas";
import { MobileSessionSheet } from "@/components/mobile-session-sheet";
import { SessionSidebar } from "@/components/session-sidebar";
import { useOptionalSessionWorkspace } from "@/components/session-workspace-context";
import { SkillSuggestions } from "@/components/skill-suggestions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { claimPendingPrompt, storePendingPrompt } from "@/lib/pending-prompt";
import { insertSkillMention } from "@/lib/skill-mention";
import {
  createWebChat,
  replaceClientUrl,
  revealSessionPath,
  sessionPath,
  warmEveRuntime,
} from "@/lib/start-web-session";
import {
  hasSettledSessionTail,
  latestTurnReplyText,
  hasTerminalSessionTail,
  isInactiveSessionError,
  sessionContextUsage,
  shouldResumeEveSession,
} from "@/lib/session-events";
import { documentsFromToolOutput } from "@/lib/client-documents";
import { isTextDocumentKind } from "@/lib/document-kind";
import { cn, fetchJson } from "@/lib/utils";
import {
  catalogForAssistantMessage,
  parseSessionFromStack,
  previousSessionHref,
  previousSessionId,
} from "@/lib/session-citations";
import type { ChatRecord, ClientDocument, SessionCitationSet } from "@/lib/types";
import {
  conversationFilename,
  persistChatFiles,
  transcriptDownloadMessages,
} from "./agent-chat-download";
import { AgentMessage } from "./agent-message";

const sessionToolbarHoverClass = "hover:bg-foreground/8 dark:hover:bg-foreground/12";

type AgentChatProps = {
  readonly chat?: ChatRecord;
  readonly chats?: ChatRecord[];
  readonly children?: ReactNode;
  readonly compose?: "landing" | "sidebar" | "session";
  readonly contentLoading?: boolean;
  readonly from?: string;
  readonly initialCanvasOpen?: boolean;
  readonly initialDocumentId?: string;
  readonly initialEvents?: readonly MessageStreamEvent[];
  readonly initialFiles?: FileUIPart[];
  readonly initialPrompt?: string;
};

type SessionComposer = {
  readonly busy: boolean;
  readonly cancel: () => void;
  readonly error?: string;
  readonly followUp: boolean;
  readonly submit: (message: PromptInputMessage) => void;
  readonly submitting: boolean;
  readonly status?: ChatStatus;
};

const idleComposer: SessionComposer = {
  busy: false,
  cancel: () => undefined,
  followUp: false,
  submit: () => undefined,
  submitting: false,
};

const STREAM_CHECKPOINT_MS = 3_000;

export function AgentChat(props: AgentChatProps) {
  const [storeGeneration, setStoreGeneration] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [composer, setComposer] = useState<SessionComposer>(idleComposer);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [canvasHost, setCanvasHost] = useState<HTMLDivElement | null>(null);
  const [resume, setResume] = useState(() =>
    shouldResumeEveSession(props.chat?.sessionId, props.initialEvents),
  );
  const hydratedEventsRef = useRef(props.initialEvents ?? []);
  const hydratedChatKeyRef = useRef(props.chat?.id ?? "draft");
  const remountingRef = useRef(false);
  const retryRef = useRef<PromptInputMessage>(undefined);
  const landing = props.compose === "landing" && !props.chat;
  const chatKey = props.chat?.id ?? "draft";
  if (hydratedChatKeyRef.current !== chatKey) {
    hydratedChatKeyRef.current = chatKey;
    // eslint-disable-next-line react-hooks/refs -- reset hydration when the chat changes
    hydratedEventsRef.current = props.initialEvents ?? [];
  }

  const onHydrateEvents = useCallback((events: readonly MessageStreamEvent[]) => {
    hydratedEventsRef.current = [...events];
  }, []);

  const onStuckResuming = useCallback((retry?: PromptInputMessage) => {
    if (retry) retryRef.current = retry;
    if (remountingRef.current && !retry) return;
    remountingRef.current = true;
    setResume(false);
    setStoreGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    retryRef.current = undefined;
    remountingRef.current = false;
  }, [storeGeneration]);

  useLayoutEffect(() => {
    setCanvasHost(canvasHostRef.current);
  }, []);

  const session = (
    <AgentChatSession
      key={`${props.chat?.id ?? "draft"}:${storeGeneration}`}
      {...props}
      // eslint-disable-next-line react-hooks/refs -- remount handoff
      autoSend={retryRef.current}
      canvasHost={landing ? undefined : canvasHost}
      hideComposer={!landing}
      // eslint-disable-next-line react-hooks/refs -- remount handoff
      initialEvents={hydratedEventsRef.current}
      onComposerChange={landing ? undefined : setComposer}
      prompt={prompt}
      resume={resume}
      setPrompt={setPrompt}
      onHydrateEvents={onHydrateEvents}
      onStuckResuming={onStuckResuming}
    />
  );

  if (landing) return session;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col" id="main" tabIndex={-1}>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {session}
        </div>
        <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pb-6 sm:px-6">
          {composer.error ? (
            <p className="text-center text-destructive text-sm" role="alert">
              {composer.error}
            </p>
          ) : null}
          <HomePrompt
            busy={composer.busy}
            onCancel={composer.cancel}
            onSubmit={composer.submit}
            placeholder={composer.followUp ? appConfig.home.followUpPlaceholder : undefined}
            prompt={prompt}
            setPrompt={setPrompt}
            slashMenuPlacement="above-input"
            status={composer.status}
            submitting={composer.submitting || Boolean(props.contentLoading)}
          />
        </div>
      </main>
      <div className="hidden min-h-0 lg:flex" ref={canvasHostRef} />
    </div>
  );
}

function AgentChatSession({
  chat,
  chats = [],
  children,
  compose = "session",
  contentLoading = false,
  from,
  initialCanvasOpen = false,
  initialDocumentId,
  initialEvents = [],
  initialFiles,
  initialPrompt,
  autoSend,
  canvasHost,
  hideComposer = false,
  prompt,
  resume = false,
  setPrompt,
  onComposerChange,
  onHydrateEvents,
  onStuckResuming,
}: AgentChatProps & {
  readonly autoSend?: PromptInputMessage;
  readonly canvasHost?: HTMLElement | null;
  readonly hideComposer?: boolean;
  readonly onComposerChange?: (composer: SessionComposer) => void;
  readonly prompt: string;
  readonly resume?: boolean;
  readonly setPrompt: Dispatch<SetStateAction<string>>;
  readonly onHydrateEvents: (events: readonly MessageStreamEvent[]) => void;
  readonly onStuckResuming: (retry?: PromptInputMessage) => void;
}) {
  const router = useRouter();
  const workspace = useOptionalSessionWorkspace();
  const embedded = compose !== "landing";
  const fromStack = parseSessionFromStack(from);
  const backHref = previousSessionHref(fromStack);
  const previousChatId = previousSessionId(fromStack);
  const [activeChat, setActiveChat] = useState(chat);
  const [creating, setCreating] = useState(false);
  const [cancellationError, setCancellationError] = useState<string>();
  const [chatTitle, setChatTitle] = useState(chat?.title ?? "New session");
  const [localChats, setLocalChats] = useState(chats);
  const chatList = workspace?.chats ?? localChats;
  const setChatList = workspace?.setChats ?? setLocalChats;
  const activeChatRef = useRef(activeChat);
  // eslint-disable-next-line react-hooks/refs -- latest chat for async handlers
  activeChatRef.current = activeChat;
  const citationNav = { currentChatId: activeChat?.id ?? "", fromStack };
  const [sessionDocuments, setSessionDocuments] = useState<ClientDocument[]>([]);
  const [canvasOpen, setCanvasOpen] = useState(initialCanvasOpen);
  const [openDocument, setOpenDocument] = useState<ClientDocument>();
  const [openContent, setOpenContent] = useState("");
  const [documentSaving, setDocumentSaving] = useState(false);
  const [citationSets, setCitationSets] = useState<SessionCitationSet[]>([]);
  const [isDesktop, setIsDesktop] = useState(false);
  const documentSaveRef = useRef<number | undefined>(undefined);
  const sentPending = useRef(false);
  const liveTurnRef = useRef(false);
  const markSessionActivityRef = useRef<() => void>(() => undefined);
  const eventsRef = useRef<MessageStreamEvent[]>([...initialEvents]);
  const sendRef = useRef<ReturnType<typeof useEveAgent>["send"] | undefined>(undefined);
  const sendErrorRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!chat) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync session from the parent
    setActiveChat(chat);
    setChatTitle(chat.title);
  }, [chat]);

  useEffect(() => {
    if (workspace) return;
    setLocalChats(() => {
      const created = activeChatRef.current;
      if (!created) return chats;
      if (chats.some((row) => row.id === created.id)) return chats;
      return [created, ...chats.filter((row) => row.id !== created.id)];
    });
  }, [chats, workspace]);

  useEffect(() => {
    if (compose === "session") return;
    router.prefetch("/s");
    warmEveRuntime();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router identity is not stable; warm once per compose mode
  }, [compose]);

  const refreshSessionDocuments = async (selectId?: string) => {
    const chatId = activeChatRef.current?.id;
    if (!chatId) return;
    const response = await fetch(`/api/documents?chatId=${chatId}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { documents: ClientDocument[] };
    setSessionDocuments(payload.documents ?? []);
    const selected =
      payload.documents.find((document) => document.id === selectId) ??
      (selectId ? undefined : openDocument);
    if (selected) {
      setOpenDocument(selected);
      if (isTextDocumentKind(selected.kind)) {
        const file = await fetch(selected.fileHref);
        setOpenContent(file.ok ? await file.text() : "");
      } else {
        setOpenContent("");
      }
    }
  };

  const refreshSessionCitations = async () => {
    const chatId = activeChatRef.current?.id;
    if (!chatId) return;
    const response = await fetch(`/api/chats/${chatId}/citations`);
    if (!response.ok) return;
    const payload = (await response.json()) as { citations?: SessionCitationSet[] };
    setCitationSets(payload.citations ?? []);
  };

  const pollSessionCitations = () => {
    for (const delay of [1500, 4000]) {
      window.setTimeout(() => {
        void refreshSessionCitations();
      }, delay);
    }
  };

  useEffect(() => {
    if (!activeChat?.id) return;
    void refreshSessionDocuments(initialDocumentId);
    void refreshSessionCitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per chat
  }, [activeChat?.id]);

  const syncCanvasUrl = (open: boolean, documentId?: string) => {
    const chatId = activeChatRef.current?.id;
    if (!chatId) return;
    replaceClientUrl(`${sessionPath(chatId)}${sessionCanvasQuery(from, open, documentId)}`);
  };

  const updateCanvasOpen = (open: boolean, documentId?: string) => {
    setCanvasOpen(open);
    syncCanvasUrl(open, documentId ?? (open ? openDocument?.id : undefined));
  };

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const applySessionSummary = (summary: { description: string; title: string }) => {
    const chatId = activeChatRef.current?.id;
    setChatTitle(summary.title);
    setChatList((current) =>
      current.map((row) =>
        row.id === chatId
          ? { ...row, description: summary.description, title: summary.title }
          : row,
      ),
    );
  };

  const markSessionActivity = () => {
    const chatId = activeChatRef.current?.id;
    if (!chatId) return;
    const updatedAt = new Date().toISOString();
    setChatList((current) =>
      current
        .map((row) => (row.id === chatId ? { ...row, updatedAt } : row))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
    void fetchJson(`/api/chats/${chatId}`, "PATCH", { touchUpdatedAt: true });
  };
  // eslint-disable-next-line react-hooks/refs -- latest activity marker
  markSessionActivityRef.current = markSessionActivity;

  const persistSession = (session: ClientSessionState | undefined) => {
    const chatId = activeChatRef.current?.id;
    if (!chatId) return;
    void fetchJson(
      `/api/chats/${chatId}`,
      "PATCH",
      session
        ? { sessionId: session.sessionId, streamIndex: session.streamIndex }
        : { sessionId: null, streamIndex: 0 },
    );
  };

  // What the server already holds for this chat, compacted. Each checkpoint
  // writes only the rows that changed, in one request, instead of one request
  // (and several database writes) per streamed token.
  // Starts empty, not from `initialEvents`: after a remount those are this
  // tab's events and may include rows the server never got. The first
  // checkpoint of a mount writes the whole compacted log (also compacting a
  // chat saved before compaction existed); later ones write only the tail.
  const storedEventsRef = useRef<MessageStreamEvent[]>([]);
  const persistInFlight = useRef(false);
  const persistQueued = useRef<{
    events: readonly MessageStreamEvent[];
    final: boolean;
    /** Only an intentional reset may shrink the stored log. */
    reset?: boolean;
  } | null>(null);
  const checkpointTimer = useRef<number | undefined>(undefined);

  const flushPersistedEvents = () => {
    if (persistInFlight.current) return;
    const queued = persistQueued.current;
    if (!queued) return;
    const chatId = activeChatRef.current?.id;
    if (!chatId) return;
    persistQueued.current = null;
    // Only an intentional reset may write an empty log; an empty snapshot
    // otherwise means "nothing yet", not "delete everything".
    if (queued.events.length === 0 && !queued.reset) return;
    const next = compactStreamEvents(queued.events);
    const stored = storedEventsRef.current;
    const fromIndex = firstChangedIndex(stored, next, isSameStreamEvent);
    // An older or empty snapshot (a prefix of what is stored) must not trim the log.
    const stale = !queued.reset && fromIndex === next.length && next.length < stored.length;
    const unchanged = fromIndex === next.length && stored.length === next.length;
    if (stale || (unchanged && !queued.final)) {
      if (queued.final && next.length > 0) {
        persistQueued.current = { events: stored, final: true };
        flushPersistedEvents();
      }
      return;
    }
    persistInFlight.current = true;
    void fetchJson(`/api/chats/${chatId}/events`, "POST", {
      events: next.slice(fromIndex),
      final: queued.final,
      fromIndex,
      total: next.length,
    })
      .then((response) => {
        if (response.ok) storedEventsRef.current = next;
      })
      .catch(() => undefined)
      .finally(() => {
        persistInFlight.current = false;
        if (persistQueued.current) flushPersistedEvents();
      });
  };

  const persistEvents = (events: readonly MessageStreamEvent[], final = false) => {
    window.clearTimeout(checkpointTimer.current);
    checkpointTimer.current = undefined;
    persistQueued.current = {
      events,
      final: final || Boolean(persistQueued.current?.final),
      reset: persistQueued.current?.reset,
    };
    flushPersistedEvents();
  };

  /** While a turn streams, checkpoint every few seconds so a reload can resume it. */
  const scheduleCheckpoint = () => {
    if (checkpointTimer.current !== undefined) return;
    checkpointTimer.current = window.setTimeout(() => {
      checkpointTimer.current = undefined;
      persistEvents(eventsRef.current);
    }, STREAM_CHECKPOINT_MS);
  };

  useEffect(() => () => window.clearTimeout(checkpointTimer.current), []);

  const agent = useEveAgent({
    initialEvents,
    initialSession:
      chat?.sessionId
        ? {
            sessionId: chat.sessionId,
            streamIndex: chat.streamIndex,
          }
        : undefined,
    resume,
    onEvent(event) {
      eventsRef.current = [...eventsRef.current, event];
      onHydrateEvents(eventsRef.current);
      scheduleCheckpoint();
      if (event.type === "action.result") {
        const documents = documentsFromToolOutput(
          "output" in event.data ? event.data.output : undefined,
        );
        if (documents.length > 0) {
          updateCanvasOpen(true, documents[0]?.id);
          void refreshSessionDocuments(documents[0]?.id);
          const chatId = activeChatRef.current?.id;
          if (chatId) {
            for (const document of documents) {
              void fetchJson(`/api/documents/${document.id}/sessions`, "POST", { chatId }).then(
                () => refreshSessionDocuments(document.id),
              );
            }
          }
        }
      }
    },
    onSessionChange(session) {
      if (session) persistSession(session);
    },
    onFinish(snapshot) {
      eventsRef.current = [...snapshot.events];
      onHydrateEvents(snapshot.events);
      persistSession(snapshot.session);
      if (liveTurnRef.current) {
        liveTurnRef.current = false;
        markSessionActivityRef.current();
        // Voice mode reads the reply aloud, but only for a turn just sent from
        // this tab, never when replaying or resuming an older one.
        if (isVoiceModeOn()) {
          void speakText(latestTurnReplyText(snapshot.events), activeChatRef.current?.id);
        }
      }
      void refreshSessionCitations();
      // Persist off the store's completion path so stringify/fetch cannot
      // keep the composer locked after the turn has already settled.
      window.setTimeout(() => persistEvents(snapshot.events, true), 0);
    },
    onError(error) {
      sendErrorRef.current = error.message;
      setCancellationError(error.message);
    },
  });

  // eslint-disable-next-line react-hooks/refs -- latest send for retries
  sendRef.current = agent.send;
  const cancelAgentRef = useRef(agent.cancel);
  // eslint-disable-next-line react-hooks/refs -- latest cancel for workspace registration
  cancelAgentRef.current = agent.cancel;
  const sendPromptRef = useRef<(message: PromptInputMessage) => Promise<void>>(undefined);

  useEffect(() => {
    return workspace?.registerCancel(async (chatId) => {
      if (activeChatRef.current?.id === chatId) {
        await cancelAgentRef.current().catch(() => undefined);
      }
    });
  }, [workspace?.registerCancel]);

  const refreshSessionTitle = (prompt: string) => {
    const prior = agent.data.messages.flatMap((message) => {
      if (message.role !== "user") return [];
      const text = message.parts
        .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
        .join(" ")
        .trim();
      return text ? [text] : [];
    });
    const current = activeChatRef.current;
    if (!current) return;
    const previous = {
      description: chatList.find((row) => row.id === current.id)?.description ?? current.description,
      title: chatTitle,
    };
    void fetchJson(`/api/chats/${current.id}/title`, "POST", {
      messages: sessionTitleMessages([...prior, prompt].filter(Boolean)),
      prompt,
    })
      .then(() => pollSessionSummary(current.id, previous, applySessionSummary))
      .catch(() => undefined);
  };

  const ensureChat = async (text: string): Promise<ChatRecord> => {
    const existing = activeChatRef.current;
    if (existing) return existing;
    setCreating(true);
    try {
      const created = await createWebChat(text);
      activeChatRef.current = created;
      setActiveChat(created);
      setChatTitle(created.title);
      setChatList((current) => [created, ...current.filter((row) => row.id !== created.id)]);
      workspace?.setActiveChatId(created.id);
      revealSessionPath(created.id);
      router.prefetch(sessionPath(created.id));
      return created;
    } catch (error) {
      setCreating(false);
      throw error;
    }
  };

  const startFreshSession = () => {
    eventsRef.current = [];
    // An intentional reset is the one write allowed to empty the stored log.
    window.clearTimeout(checkpointTimer.current);
    checkpointTimer.current = undefined;
    persistQueued.current = { events: [], final: false, reset: true };
    flushPersistedEvents();
    agent.reset();
    persistSession(undefined);
  };

  useEffect(() => {
    if (agent.status === "resuming" && hasSettledSessionTail(agent.events)) {
      onHydrateEvents(agent.events);
      onStuckResuming();
    }
  }, [agent.events, agent.status, onHydrateEvents, onStuckResuming]);

  useEffect(() => {
    if (!autoSend) return;
    const timeout = window.setTimeout(() => {
      void sendPromptRef.current?.(autoSend).catch((error: unknown) => {
        setCancellationError(toErrorMessage(error));
      });
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [autoSend]);

  useEffect(() => {
    const chatId = activeChat?.id;
    const text = initialPrompt?.trim() ?? "";
    if (!chatId || (!text && !initialFiles?.length)) return;

    // Defer past React Strict Mode's immediate unmount so we do not claim the
    // pending prompt on a useEveAgent store that is about to be detached.
    const timeout = window.setTimeout(() => {
      if (sentPending.current) return;
      if (!claimPendingPrompt(chatId)) return;
      sentPending.current = true;
      void sendPromptRef.current?.({ files: initialFiles ?? [], text }).catch((error: unknown) => {
        setCancellationError(toErrorMessage(error));
      });
    }, 0);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeChat?.id, initialFiles, initialPrompt]);

  const settledTail = hasSettledSessionTail(agent.events);
  const hookBusy = agent.status === "submitted" || agent.status === "streaming";
  const isBusy = hookBusy && !settledTail;

  useEffect(() => {
    if (hookBusy) liveTurnRef.current = true;
  }, [hookBusy]);
  const isResuming = agent.status === "resuming" && !settledTail;
  const lastMessage = agent.data.messages.at(-1);
  const isPendingAssistantShell =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.every((part) => part.type === "step-start");
  const showPendingThinking =
    isBusy &&
    (agent.status === "submitted" || lastMessage?.role !== "assistant" || isPendingAssistantShell);
  const turnFailure = isBusy || isResuming ? undefined : getLatestTurnFailure(agent.events);
  const errorMessage = cancellationError ?? agent.error?.message ?? turnFailure;
  const hasPendingInitial = Boolean(initialPrompt?.trim() || initialFiles?.length);
  const isEmpty =
    agent.data.messages.length === 0 &&
    !showPendingThinking &&
    errorMessage === undefined &&
    !hasPendingInitial &&
    !creating;
  const contextUsage = sessionContextUsage(agent.events);
  const downloadMessages = transcriptDownloadMessages(agent.data.messages);

  const requestCancellation = async () => {
    setCancellationError(undefined);
    try {
      await agent.cancel();
      persistEvents(eventsRef.current, true);
    } catch (error: unknown) {
      setCancellationError(toErrorMessage(error));
    }
  };

  const sendTurn = async (content: string | UserContent, steer: boolean) => {
    const options = steer ? { turnPolicy: "steer" as const } : undefined;
    sendErrorRef.current = undefined;
    try {
      await agent.send(content, options);
    } catch (error: unknown) {
      const message = toErrorMessage(error);
      sendErrorRef.current = message;
      if (!steer && message.includes("already processing")) {
        await agent.cancel().catch(() => undefined);
        sendErrorRef.current = undefined;
        await agent.send(content);
        return;
      }
    }

    const failed = sendErrorRef.current;
    if (failed && isInactiveSessionError(failed)) {
      startFreshSession();
      sendErrorRef.current = undefined;
      setCancellationError(undefined);
      await agent.send(content);
    }
  };

  const sendPrompt = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if ((text.length === 0 && message.files.length === 0) || isResuming || creating) return;

    const priorError = cancellationError ?? agent.error?.message;
    const startedNewChat = !activeChatRef.current;
    setPrompt("");
    setCancellationError(undefined);

    let turn: Promise<void> | undefined;
    try {
      await ensureChat(text || "New session");

      const chatId = activeChatRef.current?.id;
      if (startedNewChat && chatId) {
        storePendingPrompt(chatId, { files: message.files, text });
      }

      if (hasTerminalSessionTail(agent.events) || isInactiveSessionError(priorError ?? "")) {
        startFreshSession();
      }

      const content: string | UserContent =
        message.files.length === 0
          ? text
          : [
              ...(text.length > 0 ? [{ text, type: "text" as const }] : []),
              ...message.files.map((file) => ({
                data: file.url,
                filename: file.filename,
                mediaType: file.mediaType,
                type: "file" as const,
              })),
            ];

      if (chatId && message.files.length > 0) {
        void persistChatFiles(chatId, message.files).then(() => refreshSessionDocuments());
      }

      turn = sendTurn(content, isBusy);
      if (startedNewChat && chatId) {
        claimPendingPrompt(chatId);
      }
      liveTurnRef.current = true;
      markSessionActivity();
      refreshSessionTitle(text || "New session");
      void pollSessionCitations();
    } catch (error: unknown) {
      setCancellationError(toErrorMessage(error));
    } finally {
      setCreating(false);
    }

    if (!turn) return;

    try {
      await turn;
      if (sendErrorRef.current?.includes("resuming")) {
        onHydrateEvents(eventsRef.current);
        onStuckResuming(message);
      }
    } catch (error: unknown) {
      setCancellationError(toErrorMessage(error));
    }
  };

  // eslint-disable-next-line react-hooks/refs -- latest sendPrompt for layout effects
  sendPromptRef.current = sendPrompt;

  const composerSubmitting = creating || isResuming;
  const composerError = errorMessage;
  const previousChatTitle = previousChatId
    ? chatList.find((row) => row.id === previousChatId)?.title
    : undefined;
  const headerTitle =
    contentLoading && workspace?.activeChatId
      ? (workspace.chats.find((row) => row.id === workspace.activeChatId)?.title ?? chatTitle)
      : chatTitle;
  const pendingTitle = !activeChat && workspace?.activeChatId
    ? workspace.chats.find((row) => row.id === workspace.activeChatId)?.title
    : undefined;

  useLayoutEffect(() => {
    onComposerChange?.({
      busy: isBusy,
      cancel: () => {
        void requestCancellation();
      },
      error: hideComposer ? composerError : undefined,
      followUp: Boolean(activeChat) && !isEmpty,
      status: toChatStatus(agent.status),
      submit: (message) => {
        void sendPromptRef.current?.(message);
      },
      submitting: composerSubmitting,
    });
  }, [
    activeChat,
    agent.status,
    composerError,
    composerSubmitting,
    hideComposer,
    isBusy,
    isEmpty,
    onComposerChange,
  ]);

  useEffect(() => {
    return () => onComposerChange?.(idleComposer);
  }, [onComposerChange]);

  const saveOpenDocument = (documentId: string, content: string) => {
    setOpenContent(content);
    window.clearTimeout(documentSaveRef.current);
    documentSaveRef.current = window.setTimeout(() => {
      setDocumentSaving(true);
      void fetchJson(`/api/documents/${documentId}`, "PATCH", { content }).finally(() =>
        setDocumentSaving(false),
      );
    }, 700);
  };

  const deleteChat = async (target: ChatRecord) => {
    if (workspace) {
      try {
        await workspace.deleteChat(target);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to delete this session.";
        setCancellationError(message);
        throw error instanceof Error ? error : new Error(message);
      }
      return;
    }

    const currentId = activeChatRef.current?.id;
    if (target.id === currentId) {
      await agent.cancel().catch(() => undefined);
    }
    const response = await fetch(`/api/chats/${target.id}`, { method: "DELETE" });
    if (!response.ok) {
      const message = "Unable to delete this session.";
      setCancellationError(message);
      throw new Error(message);
    }
    if (target.id === currentId) {
      router.replace("/s");
      router.refresh();
      return;
    }
    setChatList((current) => current.filter((row) => row.id !== target.id));
  };

  const submitPrompt = (message: PromptInputMessage) => {
    void sendPrompt(message);
  };

  const insertSkill = (slug: string) => {
    setPrompt((current) => insertSkillMention(current, slug).value);
  };

  if (!activeChat && compose === "landing") {
    return (
      <div className="flex min-h-dvh flex-col bg-background pb-[env(safe-area-inset-bottom)]">
        <AppHeader />
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 pt-6 pb-20" id="main" tabIndex={-1}>
          <BrandHero />
          <div className="flex flex-col items-center gap-4">
            <HomePrompt
              busy={isBusy}
              onCancel={() => void requestCancellation()}
              prompt={prompt}
              setPrompt={setPrompt}
              status={toChatStatus(agent.status)}
              submitting={composerSubmitting}
              onSubmit={submitPrompt}
            />
            {composerError ? (
              <p className="text-center text-destructive text-sm" role="alert">
                {composerError}
              </p>
            ) : null}
            <SkillSuggestions disabled={composerSubmitting} onSelect={insertSkill} />
          </div>
          {children}
        </main>
      </div>
    );
  }

  const desktopCanvas =
    canvasOpen && isDesktop ? (
      <SessionDocumentCanvas
        documents={sessionDocuments}
        openContent={openContent}
        openDocument={openDocument}
        saving={documentSaving}
        onClose={() => updateCanvasOpen(false)}
        onOpen={(document) => {
          updateCanvasOpen(true, document.id);
          void refreshSessionDocuments(document.id);
        }}
        onSave={saveOpenDocument}
      />
    ) : null;
  const conversation = (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pt-8 pb-8 sm:px-6">
        {agent.data.messages.map((message, index) =>
          showPendingThinking &&
          isPendingAssistantShell &&
          message.id === lastMessage.id ? null : (
            <AgentMessage
              canRespond={!isBusy && !isResuming}
              citationNav={citationNav}
              citations={catalogForAssistantMessage(
                message,
                agent.data.messages,
                citationSets,
              )}
              isStreaming={
                agent.status === "streaming" && index === agent.data.messages.length - 1
              }
              key={message.id}
              message={message}
              onOpenDocument={(document) => {
                updateCanvasOpen(true, document.id);
                void refreshSessionDocuments(document.id);
              }}
              onInputResponses={(inputResponses) => {
                setCancellationError(undefined);
                return agent.respond(inputResponses);
              }}
            />
          ),
        )}
        {showPendingThinking ? <PendingThinking /> : null}
        {errorMessage && !hideComposer ? <ErrorMessage message={errorMessage} /> : null}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
  const body = contentLoading ? (
    <SessionMessagesLoading />
  ) : isEmpty || !activeChat ? (
    <SessionEmptyCanvas disabled={composerSubmitting} onSelectSkill={insertSkill}>
      {composerError && !hideComposer ? (
        <p className="text-center text-destructive text-sm" role="alert">
          {composerError}
        </p>
      ) : null}
    </SessionEmptyCanvas>
  ) : (
    conversation
  );

  const toolbar = (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <MobileSessionSheet
        activeChatId={activeChat?.id}
        chats={chatList}
        onDeleteChat={deleteChat}
        triggerClassName="md:hidden"
      />
      <Button
        asChild
        className={`md:hidden ${sessionToolbarHoverClass}`}
        size="icon-sm"
        variant="ghost"
      >
        <Link
          aria-label="New session"
          href="/s"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
              return;
            }
            if (!workspace) return;
            event.preventDefault();
            workspace.openNewSession();
          }}
        >
          <PlusIcon aria-hidden="true" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        {activeChat && backHref ? (
          <Link
            aria-label={`Back to ${previousChatTitle ?? "previous session"}`}
            className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            href={backHref}
            prefetch={false}
          >
            <ArrowLeftIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{previousChatTitle ?? "Previous session"}</span>
          </Link>
        ) : null}
        <span className="block truncate text-sm">
          {activeChat ? headerTitle : (pendingTitle ?? "New session")}
        </span>
      </div>
      {activeChat ? (
        <div className="ml-auto flex items-center gap-1">
          {contextUsage ? (
            <div className="hidden md:block">
              <SessionContextPopover
                chatId={activeChat.id}
                contextUsage={contextUsage}
                settled={settledTail}
              />
            </div>
          ) : null}
          {downloadMessages.length > 0 ? (
            <ConversationDownload
              aria-label="Download conversation"
              className={`relative top-auto right-auto ${sessionToolbarHoverClass}`}
              filename={conversationFilename(chatTitle, activeChat.id)}
              messages={downloadMessages}
              size="icon-sm"
              variant="ghost"
            />
          ) : null}
          <Button
            aria-label={
              sessionDocuments.length > 0
                ? `Files, ${sessionDocuments.length}`
                : "No files in this session"
            }
            className={cn(
              sessionDocuments.length > 0
                ? sessionToolbarHoverClass
                : "text-muted-foreground",
            )}
            disabled={sessionDocuments.length === 0}
            size="sm"
            type="button"
            variant={canvasOpen ? "secondary" : "ghost"}
            onClick={() => {
              if (sessionDocuments.length === 0) return;
              updateCanvasOpen(!canvasOpen);
            }}
          >
            <FileTextIcon aria-hidden="true" />
            Files
            {sessionDocuments.length > 0 ? (
              <span className="text-muted-foreground">{sessionDocuments.length}</span>
            ) : null}
          </Button>
        </div>
      ) : null}
    </div>
  );

  const filesSheet = (
    <Sheet
      open={canvasOpen && !isDesktop}
      onOpenChange={(open) => updateCanvasOpen(open, open ? openDocument?.id : undefined)}
    >
      <SheetContent className="w-full p-0 sm:max-w-md lg:hidden" side="right">
        <SheetTitle className="sr-only">Session files</SheetTitle>
        <SessionDocumentCanvas
          documents={sessionDocuments}
          openContent={openContent}
          openDocument={openDocument}
          saving={documentSaving}
          onClose={() => updateCanvasOpen(false)}
          onOpen={(document) => {
            updateCanvasOpen(true, document.id);
            void refreshSessionDocuments(document.id);
          }}
          onSave={saveOpenDocument}
        />
      </SheetContent>
    </Sheet>
  );

  if (hideComposer) {
    return (
      <SessionChrome
        activeChatId={activeChat?.id}
        chats={chatList}
        embedded={embedded}
        onDeleteChat={deleteChat}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {toolbar}
          {body}
        </div>
        {canvasHost?.isConnected && desktopCanvas
          ? createPortal(desktopCanvas, canvasHost)
          : null}
        {filesSheet}
      </SessionChrome>
    );
  }

  return (
    <SessionChrome
      activeChatId={activeChat?.id}
      chats={chatList}
      embedded={embedded}
      onDeleteChat={deleteChat}
    >
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col" id="main" tabIndex={-1}>
          {toolbar}
          {body}
          <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pb-6 sm:px-6">
            {composerError ? (
              <p className="text-center text-destructive text-sm" role="alert">
                {composerError}
              </p>
            ) : null}
            <HomePrompt
              busy={isBusy}
              onCancel={() => void requestCancellation()}
              placeholder={activeChat && !isEmpty ? appConfig.home.followUpPlaceholder : undefined}
              prompt={prompt}
              setPrompt={setPrompt}
              slashMenuPlacement="above-input"
              status={toChatStatus(agent.status)}
              submitting={composerSubmitting}
              onSubmit={submitPrompt}
            />
          </div>
        </main>
        {canvasOpen ? <div className="hidden h-full min-h-0 lg:flex">{desktopCanvas}</div> : null}
      </div>
      {filesSheet}
    </SessionChrome>
  );
}

function SessionChrome({
  activeChatId,
  chats,
  children,
  embedded,
  onDeleteChat,
}: {
  readonly activeChatId?: string;
  readonly chats: ChatRecord[];
  readonly children: ReactNode;
  readonly embedded: boolean;
  readonly onDeleteChat: (chat: ChatRecord) => Promise<void>;
}) {
  if (embedded) return children;
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background pb-[env(safe-area-inset-bottom)] text-foreground">
      <AppHeader hideOnMobile />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="hidden h-full min-h-0 md:flex md:flex-col">
          <SessionSidebar activeChatId={activeChatId} chats={chats} onDeleteChat={onDeleteChat} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function sessionCanvasQuery(from: string | undefined, open: boolean, documentId?: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (open && documentId) {
    params.set("doc", documentId);
  } else if (open) {
    params.set("docs", "1");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function ErrorMessage({ message }: { readonly message: string }) {
  return (
    <Message className="max-w-full" from="assistant">
      <MessageContent>
        <Alert role="alert" variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </MessageContent>
    </Message>
  );
}

function PendingThinking() {
  return (
    <Message aria-live="polite" from="assistant">
      <MessageContent>
        <div className="mb-4 flex w-full items-center gap-2 text-muted-foreground text-sm">
          <BrainIcon aria-hidden="true" className="size-4" />
          <Shimmer duration={1}>Thinking…</Shimmer>
        </div>
      </MessageContent>
    </Message>
  );
}

function sessionTitleMessages(messages: readonly string[]): string[] {
  if (messages.length <= 6) return [...messages];
  const [first] = messages;
  const recent = messages.slice(-5);
  return recent.includes(first) ? messages.slice(-6) : [first, ...recent];
}

function toChatStatus(status: ReturnType<typeof useEveAgent>["status"]): ChatStatus | undefined {
  if (status === "submitted" || status === "streaming" || status === "error") {
    return status;
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to cancel the response.";
}

async function pollSessionSummary(
  chatId: string,
  previous: { description: string; title: string },
  onSummary: (summary: { description: string; title: string }) => void,
) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    try {
      const response = await fetch(`/api/chats/${chatId}/title`);
      if (!response.ok) continue;
      const payload = (await response.json()) as { description?: string; title?: string };
      const title = payload.title ?? previous.title;
      const description = payload.description ?? previous.description;
      if (title !== previous.title || description !== previous.description) {
        onSummary({ description, title });
        return;
      }
    } catch {
      // Title refresh is best-effort and must not affect the session.
    }
  }
}

function isSameStreamEvent(left: MessageStreamEvent, right: MessageStreamEvent): boolean {
  if (left === right) return true;

  const leftId = left.meta?.id;
  const rightId = right.meta?.id;
  if (typeof leftId === "string" && typeof rightId === "string") {
    return leftId === rightId;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function getLatestTurnFailure(
  events: ReturnType<typeof useEveAgent>["events"],
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];

    if (event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? "The model is temporarily unavailable. Please try again."
        : event.data.message;
    }

    if (event.type === "turn.completed" || event.type === "turn.cancelled") {
      return undefined;
    }

    if (event.type === "message.received") {
      return undefined;
    }
  }

  return undefined;
}
