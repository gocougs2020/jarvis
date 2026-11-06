import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailRecord } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  fetchReceivedEmailContent: vi.fn(),
  receivedAuthenticationResults: vi.fn(),
  receivedThreadHeaders: vi.fn(),
  ensureSentMessageId: vi.fn(),
  listEmails: vi.fn(),
  getChat: vi.fn(),
  persistEmailEmbeddings: vi.fn(),
  classifyEmailAction: vi.fn(),
  findUserById: vi.fn(),
  inboundMailOwner: vi.fn(),
  agentResendInboxActive: vi.fn(),
  getEmailByResendId: vi.fn(),
  createEmail: vi.fn(),
  updateEmail: vi.fn(),
  getEmail: vi.fn(),
  createChat: vi.fn(),
  createJob: vi.fn(),
  deleteChat: vi.fn(),
  updateChat: vi.fn(),
}));

vi.mock("@/lib/email-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-content")>();
  return {
    ...actual,
    fetchReceivedEmailContent: mocks.fetchReceivedEmailContent,
    receivedAuthenticationResults: mocks.receivedAuthenticationResults,
    receivedThreadHeaders: mocks.receivedThreadHeaders,
  };
});

vi.mock("@/lib/email-send", () => ({ ensureSentMessageId: mocks.ensureSentMessageId }));

vi.mock("@/lib/email-embeddings", () => ({
  EMAIL_EMBEDDING_KINDS: ["email_subject", "email_body"],
  EMAIL_SEARCH_MIN_SCORE: 0.32,
  persistEmailEmbeddings: mocks.persistEmailEmbeddings,
}));

vi.mock("@/lib/email-classify", () => ({
  classifyEmailAction: mocks.classifyEmailAction,
  emailActionSessionPrompt: () => "Complete the request in this email.",
}));

vi.mock("@/lib/email-users", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email-users")>();
  return { ...actual, findUserById: mocks.findUserById, inboundMailOwner: mocks.inboundMailOwner };
});

vi.mock("@/lib/resend-inbox", () => ({
  agentResendInboxActive: mocks.agentResendInboxActive,
  getInboxThreadEmail: vi.fn(),
  isAgentResendInbox: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getEmailByResendId: mocks.getEmailByResendId,
  createEmail: mocks.createEmail,
  updateEmail: mocks.updateEmail,
  getEmail: mocks.getEmail,
  createChat: mocks.createChat,
  createJob: mocks.createJob,
  deleteChat: mocks.deleteChat,
  updateChat: mocks.updateChat,
  listEmails: mocks.listEmails,
  getChat: mocks.getChat,
  titleFromPrompt: (value: string) => value,
}));

import { ReceivedEmailContentError } from "@/lib/email-content";
import { chatAcceptsEmailTurns, processInboundResendEmail } from "@/lib/email-inbox";

const ENV_KEYS = ["RESEND_FROM_EMAIL"] as const;
const original: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const originalAuthUrl = process.env.BETTER_AUTH_URL;

function env() {
  return process.env as Record<string, string | undefined>;
}

for (const key of ENV_KEYS) {
  original[key] = process.env[key];
}

function emailRecord(overrides: Partial<EmailRecord> = {}): EmailRecord {
  return {
    id: "mail-1",
    userId: "user-1",
    direction: "inbound",
    fromAddress: "ada@example.com",
    toAddresses: ["agent@example.com"],
    ccAddresses: [],
    subject: "Dinner",
    bodyText: "Table for two.",
    bodyHtml: "<p>Table for <strong>two</strong>.</p>",
    resendEmailId: "email_123",
    status: "received",
    hasActionItem: false,
    actionSummary: null,
    chatId: null,
    inReplyTo: null,
    attachments: [],
    messageId: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  env().RESEND_FROM_EMAIL = "Jarvis <agent@example.com>";
  delete (process.env as Record<string, string | undefined>).BETTER_AUTH_URL;

  mocks.findUserById.mockResolvedValue({ id: "user-1", email: "ada@example.com", name: "Ada" });
  mocks.inboundMailOwner.mockImplementation(async (from: string) => ({
    user: { id: "user-1", email: "ada@example.com", name: "Ada" },
    fromAccount: from === "ada@example.com",
  }));
  mocks.agentResendInboxActive.mockResolvedValue(false);
  mocks.getEmailByResendId.mockResolvedValue(null);
  mocks.createEmail.mockImplementation(async (input: EmailRecord) => emailRecord(input));
  mocks.getEmail.mockResolvedValue(null);
  mocks.persistEmailEmbeddings.mockResolvedValue(undefined);
  mocks.classifyEmailAction.mockResolvedValue({ hasActionItem: false, summary: "", prompt: "" });
  mocks.fetchReceivedEmailContent.mockResolvedValue({
    subject: "Dinner",
    from: "Ada <ada@example.com>",
    to: ["agent@example.com"],
    cc: [],
    receivedFor: ["agent@example.com"],
    bodyHtml: "<p>Table for <strong>two</strong>.</p>",
    bodyText: "Table for two.",
    attachments: [],
    messageId: "reply-1@mail.example.com",
    inReplyTo: [],
    references: [],
  });
  mocks.receivedThreadHeaders.mockResolvedValue({ messageId: null, inReplyTo: [], references: [] });
  mocks.ensureSentMessageId.mockImplementation(async (email: EmailRecord) => email);
  mocks.listEmails.mockResolvedValue([]);
  mocks.getChat.mockResolvedValue(null);
  mocks.receivedAuthenticationResults.mockResolvedValue([
    "mx.example; dmarc=pass header.from=example.com",
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
  const store = env();
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete store[key];
    else store[key] = original[key];
  }
  if (originalAuthUrl === undefined) delete store.BETTER_AUTH_URL;
  else store.BETTER_AUTH_URL = originalAuthUrl;
});

const inbound = {
  emailId: "email_123",
  from: "ada@example.com",
  to: ["agent@example.com"],
  subject: "Dinner",
};

describe("processInboundResendEmail", () => {
  it("fetches and stores HTML and text before cataloging", async () => {
    const stored = await processInboundResendEmail(inbound);
    expect(mocks.fetchReceivedEmailContent).toHaveBeenCalledWith("email_123");
    expect(mocks.createEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyHtml: "<p>Table for <strong>two</strong>.</p>",
        bodyText: "Table for two.",
        subject: "Dinner",
      }),
    );
    expect(mocks.persistEmailEmbeddings).toHaveBeenCalled();
    expect(stored?.bodyHtml).toContain("<strong>two</strong>");
    expect(stored?.bodyText).toBe("Table for two.");
    expect(mocks.createChat).not.toHaveBeenCalled();
  });

  it("catalogs forwarded mail even when From is not the account owner", async () => {
    await processInboundResendEmail({
      ...inbound,
      from: "hotel@example.com",
    });
    expect(mocks.createEmail).toHaveBeenCalled();
    expect(mocks.createChat).not.toHaveBeenCalled();
  });

  it("starts a session only for an owner action email", async () => {
    mocks.classifyEmailAction.mockResolvedValue({
      hasActionItem: true,
      summary: "Book dinner",
      prompt: "Book dinner for two.",
    });
    mocks.createChat.mockResolvedValue({ id: "chat-1" });
    mocks.updateEmail.mockResolvedValue(emailRecord({ hasActionItem: true, actionSummary: "Book dinner" }));

    await processInboundResendEmail(inbound);
    expect(mocks.createChat).toHaveBeenCalled();
  });

  it("queues a /remind follow-through when the session cannot start now", async () => {
    mocks.classifyEmailAction.mockResolvedValue({
      hasActionItem: true,
      summary: "Book dinner",
      prompt: "Book dinner for two.",
    });
    mocks.createChat.mockResolvedValue({ id: "chat-1" });
    mocks.updateEmail.mockResolvedValue(emailRecord({ hasActionItem: true, actionSummary: "Book dinner" }));

    // No dispatch secret configured, so the immediate start is skipped.
    const authSecret = process.env.BETTER_AUTH_SECRET;
    const sessionSecret = process.env.EMAIL_SESSION_SECRET;
    delete env().BETTER_AUTH_SECRET;
    delete env().EMAIL_SESSION_SECRET;
    try {
      await processInboundResendEmail(inbound);
    } finally {
      if (authSecret !== undefined) env().BETTER_AUTH_SECRET = authSecret;
      if (sessionSecret !== undefined) env().EMAIL_SESSION_SECRET = sessionSecret;
    }
    expect(mocks.deleteChat).toHaveBeenCalledWith("user-1", "chat-1");
    const [, job] = mocks.createJob.mock.calls.at(-1) ?? [];
    expect(job?.prompt).toMatch(/^\/remind\b/);
    expect(job?.prompt).toContain("Complete the request in this email.");
  });

  it("keeps the chat when the session start timed out and may be running", async () => {
    mocks.classifyEmailAction.mockResolvedValue({
      hasActionItem: true,
      summary: "Book dinner",
      prompt: "Book dinner for two.",
    });
    mocks.createChat.mockResolvedValue({ id: "chat-1" });
    mocks.updateEmail.mockResolvedValue(emailRecord({ hasActionItem: true, actionSummary: "Book dinner" }));

    const sessionSecret = process.env.EMAIL_SESSION_SECRET;
    env().EMAIL_SESSION_SECRET = "test-dispatch-secret";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    try {
      await processInboundResendEmail(inbound);
    } finally {
      vi.unstubAllGlobals();
      if (sessionSecret === undefined) delete env().EMAIL_SESSION_SECRET;
      else env().EMAIL_SESSION_SECRET = sessionSecret;
    }
    expect(mocks.deleteChat).not.toHaveBeenCalled();
    expect(mocks.updateEmail).toHaveBeenCalledWith(
      "user-1",
      "mail-1",
      expect.objectContaining({ chatId: "chat-1", status: "processed" }),
    );
    const [, job] = mocks.createJob.mock.calls.at(-1) ?? [];
    expect(job?.prompt).toMatch(/^\/remind\b/);
  });

  it("does not start a session when the owner's address fails DMARC", async () => {
    mocks.classifyEmailAction.mockResolvedValue({ hasActionItem: true, summary: "x", prompt: "x" });
    mocks.receivedAuthenticationResults.mockResolvedValue([
      "mx.example; dmarc=fail header.from=example.com",
      "forged; dmarc=pass header.from=example.com",
    ]);
    await processInboundResendEmail(inbound);
    expect(mocks.createEmail).toHaveBeenCalled();
    expect(mocks.classifyEmailAction).not.toHaveBeenCalled();
    expect(mocks.createChat).not.toHaveBeenCalled();
  });

  it("ignores mail that is not addressed to the agent", async () => {
    const stored = await processInboundResendEmail({ ...inbound, to: ["someone@example.com"] });
    expect(stored).toBeNull();
    expect(mocks.fetchReceivedEmailContent).not.toHaveBeenCalled();
  });

  it("leaves agent mail to the inbox webhook when a Resend inbox is on", async () => {
    mocks.agentResendInboxActive.mockResolvedValue(true);
    const stored = await processInboundResendEmail(inbound);
    expect(stored).toBeNull();
    expect(mocks.createEmail).not.toHaveBeenCalled();
  });

  it("does not store an empty body when receiving.get fails", async () => {
    mocks.fetchReceivedEmailContent.mockRejectedValue(
      new ReceivedEmailContentError("not ready", true),
    );
    await expect(processInboundResendEmail(inbound)).rejects.toBeInstanceOf(ReceivedEmailContentError);
    expect(mocks.createEmail).not.toHaveBeenCalled();
  });

  it("backfills HTML and text on a retry of an empty stored email", async () => {
    mocks.getEmailByResendId.mockResolvedValue(
      emailRecord({ bodyText: "", bodyHtml: "" }),
    );
    mocks.updateEmail.mockResolvedValue(
      emailRecord({ bodyText: "Table for two.", bodyHtml: "<p>Table for <strong>two</strong>.</p>" }),
    );

    const stored = await processInboundResendEmail(inbound);
    expect(mocks.fetchReceivedEmailContent).toHaveBeenCalledWith("email_123");
    expect(mocks.updateEmail).toHaveBeenCalledWith(
      "user-1",
      "mail-1",
      expect.objectContaining({
        bodyText: "Table for two.",
        bodyHtml: "<p>Table for <strong>two</strong>.</p>",
      }),
    );
    expect(mocks.createEmail).not.toHaveBeenCalled();
    expect(stored?.bodyText).toBe("Table for two.");
  });
});

describe("replies to agent email", () => {
  const parent = emailRecord({
    id: "sent-1",
    direction: "outbound",
    fromAddress: "Jarvis <agent@example.com>",
    toAddresses: ["ada@example.com"],
    subject: "Research brief: heat pumps",
    bodyText: "Here is the brief.",
    resendEmailId: "resend-sent-1",
    messageId: "brief-1@send.example.com",
    chatId: "chat-brief",
    createdAt: "2026-09-10T12:00:00.000Z",
  });
  const chat = {
    id: "chat-brief",
    userId: "user-1",
    title: "Heat pumps",
    description: "",
    source: "email",
    sessionId: "wrun_brief",
    streamIndex: 42,
    createdAt: "2026-09-10T11:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
  };
  const replyContent = {
    subject: "Re: Research brief: heat pumps",
    from: "Ada <ada@example.com>",
    to: ["agent@example.com"],
    cc: [],
    receivedFor: ["agent@example.com"],
    bodyHtml: "<p>Can you compare two brands?</p>",
    bodyText: "Can you compare two brands?\n\nOn Thu, Sep 10, 2026 at 12:00 PM Jarvis <agent@example.com> wrote:\n> Here is the brief.",
    attachments: [],
    messageId: "reply-1@mail.example.com",
    inReplyTo: ["brief-1@send.example.com"],
    references: ["brief-1@send.example.com"],
  };
  const sessionSecret = process.env.EMAIL_SESSION_SECRET;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env().EMAIL_SESSION_SECRET = "test-dispatch-secret";
    fetchMock = vi.fn().mockResolvedValue(Response.json({ sessionId: "wrun_brief", continued: true }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.fetchReceivedEmailContent.mockResolvedValue(replyContent);
    mocks.createEmail.mockImplementation(async (input: EmailRecord) =>
      emailRecord({ ...input, id: "mail-reply", createdAt: "2026-09-11T08:00:00.000Z" }),
    );
    mocks.listEmails.mockResolvedValue([parent]);
    mocks.getChat.mockImplementation(async (_userId: string, id: string) => (id === chat.id ? chat : null));
    mocks.classifyEmailAction.mockResolvedValue({
      hasActionItem: true,
      summary: "Compare two heat pump brands",
      prompt: "Compare two heat pump brands.",
    });
    mocks.updateEmail.mockImplementation(async (_userId: string, id: string, patch: Partial<EmailRecord>) =>
      emailRecord({
        ...replyContent,
        fromAddress: "ada@example.com",
        id,
        createdAt: "2026-09-11T08:00:00.000Z",
        inReplyTo: "brief-1@send.example.com",
        ...patch,
      }),
    );
    mocks.createChat.mockResolvedValue({ id: "chat-new" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (sessionSecret === undefined) delete env().EMAIL_SESSION_SECRET;
    else env().EMAIL_SESSION_SECRET = sessionSecret;
  });

  function dispatchBody(call = 0) {
    const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
    return JSON.parse(String(init?.body ?? "{}")) as Record<string, string>;
  }

  it("stores the reply's Message-ID and In-Reply-To", async () => {
    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(mocks.createEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "reply-1@mail.example.com",
        inReplyTo: "brief-1@send.example.com",
      }),
    );
  });

  it("continues the chat that sent the email instead of starting a new one", async () => {
    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });

    expect(mocks.createChat).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = dispatchBody();
    expect(body.chatId).toBe("chat-brief");
    expect(body.continueSessionId).toBe("wrun_brief");
    expect(body.prompt).toContain('replied by email to "Research brief: heat pumps"');
    expect(body.prompt).toContain("Can you compare two brands?");
    // The quoted original is already in the session.
    expect(body.prompt).not.toContain("Here is the brief.");
    expect(mocks.updateEmail).toHaveBeenCalledWith(
      "user-1",
      "mail-reply",
      expect.objectContaining({ chatId: "chat-brief", status: "processed" }),
    );
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("reads In-Reply-To from the raw message when Resend's header map lacks it", async () => {
    mocks.fetchReceivedEmailContent.mockResolvedValue({ ...replyContent, inReplyTo: [], references: [] });
    mocks.receivedThreadHeaders.mockResolvedValue({
      messageId: "reply-1@mail.example.com",
      inReplyTo: ["brief-1@send.example.com"],
      references: [],
    });
    // A different subject, so only the headers can match.
    mocks.listEmails.mockResolvedValue([{ ...parent, subject: "Something else" }]);

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(mocks.receivedThreadHeaders).toHaveBeenCalledWith("email_123");
    expect(dispatchBody().continueSessionId).toBe("wrun_brief");
  });

  it("fills in a sent Message-ID Resend had not reported yet", async () => {
    mocks.listEmails.mockResolvedValue([{ ...parent, messageId: null, subject: "Something else" }]);
    mocks.ensureSentMessageId.mockImplementation(async (email: EmailRecord) => ({
      ...email,
      messageId: "brief-1@send.example.com",
    }));

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(mocks.ensureSentMessageId).toHaveBeenCalledWith(expect.objectContaining({ id: "sent-1" }));
    expect(dispatchBody().continueSessionId).toBe("wrun_brief");
  });

  it("falls back to a matching Re: subject sent to the same address", async () => {
    mocks.fetchReceivedEmailContent.mockResolvedValue({ ...replyContent, inReplyTo: [], references: [] });
    mocks.listEmails.mockResolvedValue([{ ...parent, messageId: null }]);

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(dispatchBody().continueSessionId).toBe("wrun_brief");
  });

  it("starts a new session that links back when the original session cannot continue", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: "session_not_active" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ sessionId: "wrun_new" }));

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatchBody(0).continueSessionId).toBe("wrun_brief");
    const handoff = dispatchBody(1);
    expect(handoff.continueSessionId).toBeUndefined();
    expect(handoff.chatId).toBe("chat-new");
    expect(handoff.prompt).toContain("/s/chat-brief");
    expect(handoff.prompt).toContain("Here is the brief.");
    expect(mocks.updateChat).toHaveBeenCalledWith("user-1", "chat-new", { sessionId: "wrun_new" });
  });

  it("never sends an emailed reply into a chat started on the web", async () => {
    mocks.getChat.mockResolvedValue({ ...chat, source: "web" });
    fetchMock.mockResolvedValue(Response.json({ sessionId: "wrun_new" }));

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const handoff = dispatchBody();
    expect(handoff.continueSessionId).toBeUndefined();
    expect(handoff.chatId).toBe("chat-new");
    expect(handoff.prompt).toContain("(/s/chat-brief) was not started by email");
    expect(handoff.prompt).toContain("Here is the brief.");
    expect(mocks.createChat).toHaveBeenCalledWith("user-1", expect.any(String), "email");
    expect(mocks.updateEmail).toHaveBeenCalledWith(
      "user-1",
      "mail-reply",
      expect.objectContaining({ chatId: "chat-new", status: "processed" }),
    );
  });

  it("treats a chat a schedule started as web-only too", async () => {
    mocks.getChat.mockResolvedValue({ ...chat, source: "schedule" });
    fetchMock.mockResolvedValue(Response.json({ sessionId: "wrun_new" }));

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(dispatchBody().continueSessionId).toBeUndefined();
    expect(dispatchBody().chatId).toBe("chat-new");
  });

  it("files a reply with no ask under its conversation without running a turn", async () => {
    mocks.classifyEmailAction.mockResolvedValue({ hasActionItem: false, summary: "", prompt: "" });

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.updateEmail).toHaveBeenCalledWith("user-1", "mail-reply", { chatId: "chat-brief" });
  });

  it("never continues a session for a reply that fails DMARC", async () => {
    mocks.receivedAuthenticationResults.mockResolvedValue([
      "mx.example; dmarc=fail header.from=example.com",
    ]);

    await processInboundResendEmail({ ...inbound, subject: replyContent.subject });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.listEmails).not.toHaveBeenCalled();
    expect(mocks.updateEmail).not.toHaveBeenCalled();
  });

  it("never continues a session for a reply from someone else", async () => {
    mocks.fetchReceivedEmailContent.mockResolvedValue({ ...replyContent, from: "eve@example.com" });

    await processInboundResendEmail({ ...inbound, from: "eve@example.com", subject: replyContent.subject });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.listEmails).not.toHaveBeenCalled();
  });
});

describe("chatAcceptsEmailTurns", () => {
  it("allows only chats that email started and that have a session", () => {
    expect(chatAcceptsEmailTurns({ source: "email", sessionId: "wrun_1" })).toBe(true);
    expect(chatAcceptsEmailTurns({ source: "web", sessionId: "wrun_1" })).toBe(false);
    expect(chatAcceptsEmailTurns({ source: "schedule", sessionId: "wrun_1" })).toBe(false);
    expect(chatAcceptsEmailTurns({ source: "email", sessionId: null })).toBe(false);
  });
});
