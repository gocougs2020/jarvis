import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailRecord } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  emailsGet: vi.fn(),
  emailsSend: vi.fn(),
  getEmail: vi.fn(),
  getEmailByResendId: vi.fn(),
  createEmail: vi.fn(),
  updateEmail: vi.fn(),
  findUserById: vi.fn(),
}));

vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { get: mocks.emailsGet, send: mocks.emailsSend } }),
  resendConfigured: () => true,
}));
vi.mock("@/lib/blob-store", () => ({ getDocumentBlob: vi.fn() }));
vi.mock("@/lib/email-embeddings", () => ({ persistEmailEmbeddings: vi.fn() }));
vi.mock("@/lib/email-users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email-users")>()),
  findUserById: mocks.findUserById,
}));
vi.mock("@/lib/store", () => ({
  createEmail: mocks.createEmail,
  getDocument: vi.fn(),
  getEmail: mocks.getEmail,
  getEmailByResendId: mocks.getEmailByResendId,
  updateEmail: mocks.updateEmail,
}));

import {
  ensureSentMessageId,
  recordSentMessageId,
  resolveParentMessageId,
  sendUserEmail,
} from "@/lib/email-send";

function email(overrides: Partial<EmailRecord> = {}): EmailRecord {
  return {
    id: "mail-1",
    userId: "user-1",
    direction: "outbound",
    fromAddress: "agent@example.com",
    toAddresses: ["ada@example.com"],
    ccAddresses: [],
    subject: "Brief",
    bodyText: "Here.",
    bodyHtml: "<p>Here.</p>",
    resendEmailId: "resend-1",
    status: "sent",
    hasActionItem: false,
    actionSummary: null,
    chatId: "chat-1",
    inReplyTo: null,
    messageId: null,
    attachments: [],
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

const originalFrom = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  process.env.RESEND_FROM_EMAIL = "Jarvis <agent@example.com>";
  mocks.getEmail.mockResolvedValue(null);
  mocks.getEmailByResendId.mockResolvedValue(null);
  mocks.findUserById.mockResolvedValue({ id: "user-1", email: "ada@example.com", name: "Ada" });
  mocks.updateEmail.mockImplementation(async (_userId: string, _id: string, patch: Partial<EmailRecord>) =>
    email(patch),
  );
});

afterEach(() => {
  vi.clearAllMocks();
  if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalFrom;
});

describe("resolveParentMessageId", () => {
  it("uses the stored Message-ID of the email being answered", async () => {
    mocks.getEmail.mockResolvedValue(email({ direction: "inbound", messageId: "reply-1@mail.example.com" }));
    await expect(resolveParentMessageId("user-1", "mail-1")).resolves.toBe("reply-1@mail.example.com");
  });

  it("looks a Resend id up, but only for the same account", async () => {
    mocks.getEmailByResendId.mockResolvedValue(email({ userId: "user-2", messageId: "x@y.com" }));
    await expect(resolveParentMessageId("user-1", "resend-1")).resolves.toBeNull();
  });

  it("accepts a Message-ID and drops an id that is not one", async () => {
    await expect(resolveParentMessageId("user-1", "<A@B.com>")).resolves.toBe("a@b.com");
    await expect(resolveParentMessageId("user-1", "4f3c-unknown")).resolves.toBeNull();
    await expect(resolveParentMessageId("user-1", "a@b.com\r\nBcc: x@y.com")).resolves.toBeNull();
  });
});

describe("sent Message-IDs", () => {
  it("fills one in from Resend", async () => {
    mocks.emailsGet.mockResolvedValue({ data: { message_id: "<Brief-1@send.example.com>" }, error: null });
    const updated = await ensureSentMessageId(email());
    expect(mocks.updateEmail).toHaveBeenCalledWith("user-1", "mail-1", {
      messageId: "brief-1@send.example.com",
    });
    expect(updated.messageId).toBe("brief-1@send.example.com");
  });

  it("leaves inbound or already-known mail alone", async () => {
    await ensureSentMessageId(email({ direction: "inbound" }));
    await ensureSentMessageId(email({ messageId: "known@x.com" }));
    expect(mocks.emailsGet).not.toHaveBeenCalled();
  });

  it("records the Message-ID from the email.sent webhook", async () => {
    mocks.getEmailByResendId.mockResolvedValue(email());
    await recordSentMessageId("resend-1", "<brief-1@send.example.com>");
    expect(mocks.updateEmail).toHaveBeenCalledWith("user-1", "mail-1", {
      messageId: "brief-1@send.example.com",
    });
  });

  it("threads a reply with In-Reply-To and References and stores its own Message-ID", async () => {
    mocks.getEmail.mockResolvedValue(email({ id: "mail-in", direction: "inbound", messageId: "reply-1@mail.example.com" }));
    mocks.createEmail.mockImplementation(async (input: EmailRecord) => email({ ...input, resendEmailId: null }));
    mocks.emailsSend.mockResolvedValue({ data: { id: "resend-2" }, error: null });
    mocks.emailsGet.mockResolvedValue({ data: { message_id: "<answer-1@send.example.com>" }, error: null });

    const sent = await sendUserEmail({
      userId: "user-1",
      to: "ada@example.com",
      subject: "Re: Brief",
      body: "Compared.",
      inReplyTo: "mail-in",
      chatId: "chat-1",
      idempotencyKey: "k",
    });

    const [payload] = mocks.emailsSend.mock.calls[0] ?? [];
    expect(payload.headers).toEqual({
      "In-Reply-To": "<reply-1@mail.example.com>",
      References: "<reply-1@mail.example.com>",
    });
    expect(mocks.createEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inReplyTo: "reply-1@mail.example.com", chatId: "chat-1" }),
    );
    expect(mocks.emailsGet).toHaveBeenCalledWith("resend-2");
    expect(sent.messageId).toBe("answer-1@send.example.com");
  });
});
