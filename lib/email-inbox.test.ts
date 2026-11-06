import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailRecord } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  fetchReceivedEmailContent: vi.fn(),
  receivedAuthenticationResults: vi.fn(),
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
  };
});

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
  titleFromPrompt: (value: string) => value,
}));

import { ReceivedEmailContentError } from "@/lib/email-content";
import { processInboundResendEmail } from "@/lib/email-inbox";

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
  });
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
