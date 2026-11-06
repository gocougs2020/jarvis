import { describe, expect, it } from "vitest";
import {
  isReplySubject,
  matchReplyToOutbound,
  messageIdHeader,
  normalizeMessageId,
  normalizeReplySubject,
  parseMessageIds,
  replyParentIds,
  REPLY_SUBJECT_MATCH_WINDOW_MS,
  stripQuotedReply,
} from "@/lib/email-thread";
import type { EmailRecord } from "@/lib/types";

function outbound(overrides: Partial<EmailRecord> = {}): EmailRecord {
  return {
    id: "sent-1",
    userId: "user-1",
    direction: "outbound",
    fromAddress: "Jarvis <agent@example.com>",
    toAddresses: ["ada@example.com"],
    ccAddresses: [],
    subject: "Research brief: heat pumps",
    bodyText: "Here is the brief.",
    bodyHtml: "<p>Here is the brief.</p>",
    resendEmailId: "resend-1",
    status: "sent",
    hasActionItem: false,
    actionSummary: null,
    chatId: "chat-1",
    inReplyTo: null,
    messageId: "brief-1@send.example.com",
    attachments: [],
    createdAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

const reply = {
  inReplyTo: [] as string[],
  references: [] as string[],
  subject: "Re: Research brief: heat pumps",
  fromAddress: "Ada <ADA@example.com>",
  receivedAt: new Date("2026-09-11T08:00:00.000Z"),
};

describe("Message-ID parsing", () => {
  it("strips brackets and lowercases", () => {
    expect(normalizeMessageId(" <Abc@Example.COM> ")).toBe("abc@example.com");
    expect(normalizeMessageId("")).toBeNull();
    expect(normalizeMessageId(undefined)).toBeNull();
  });

  it("rejects values that are not a single id token", () => {
    expect(normalizeMessageId("a@b.com\r\nBcc: eve@example.com")).toBeNull();
    expect(normalizeMessageId("no-at-sign")).toBeNull();
    expect(normalizeMessageId("<a@b.com> <c@d.com>")).toBeNull();
  });

  it("splits folded References in order and drops duplicates and junk", () => {
    expect(parseMessageIds("<a@x.com>\r\n <b@y.com> <a@x.com>")).toEqual(["a@x.com", "b@y.com"]);
    expect(parseMessageIds(["c@z.com", "not-an-id"])).toEqual(["c@z.com"]);
    expect(parseMessageIds(null)).toEqual([]);
  });

  it("formats a header value", () => {
    expect(messageIdHeader("a@x.com")).toBe("<a@x.com>");
    expect(messageIdHeader("<a@x.com>")).toBe("<a@x.com>");
  });

  it("orders parents In-Reply-To first, then References newest first", () => {
    expect(
      replyParentIds({ inReplyTo: ["c@x.com"], references: ["a@x.com", "b@x.com", "c@x.com"] }),
    ).toEqual(["c@x.com", "b@x.com", "a@x.com"]);
  });
});

describe("reply subjects", () => {
  it("recognizes reply prefixes in common clients", () => {
    expect(isReplySubject("Re: Brief")).toBe(true);
    expect(isReplySubject("RE[2]: Brief")).toBe(true);
    expect(isReplySubject("AW: Brief")).toBe(true);
    expect(isReplySubject("Fwd: Brief")).toBe(false);
    expect(isReplySubject("Brief")).toBe(false);
  });

  it("normalizes nested prefixes and spacing", () => {
    expect(normalizeReplySubject("Re: RE:  Research   brief")).toBe("research brief");
  });
});

describe("matchReplyToOutbound", () => {
  it("matches In-Reply-To to a stored Message-ID", () => {
    const match = matchReplyToOutbound(
      { ...reply, subject: "something unrelated", inReplyTo: ["<BRIEF-1@send.example.com>"] },
      [outbound({ id: "other", messageId: "x@send.example.com" }), outbound()],
    );
    expect(match).toMatchObject({ matchedBy: "headers", email: { id: "sent-1" } });
  });

  it("matches the newest References entry it knows", () => {
    const match = matchReplyToOutbound(
      { ...reply, references: ["root@send.example.com", "brief-2@send.example.com"] },
      [
        outbound({ id: "root", messageId: "root@send.example.com", chatId: "chat-root" }),
        outbound({ id: "second", messageId: "brief-2@send.example.com", chatId: "chat-2" }),
      ],
    );
    expect(match?.email.id).toBe("second");
  });

  it("ignores agent mail no session sent", () => {
    expect(
      matchReplyToOutbound({ ...reply, inReplyTo: ["brief-1@send.example.com"] }, [
        outbound({ chatId: null }),
      ]),
    ).toBeNull();
  });

  it("falls back to the newest recent Re: subject sent to the replying address", () => {
    const match = matchReplyToOutbound(reply, [
      outbound({ id: "old", messageId: null, chatId: "chat-old", createdAt: "2026-09-01T00:00:00.000Z" }),
      outbound({ id: "new", messageId: null, chatId: "chat-new", createdAt: "2026-09-10T00:00:00.000Z" }),
    ]);
    expect(match).toMatchObject({ matchedBy: "subject", email: { id: "new" } });
  });

  it("does not match a subject without a reply prefix", () => {
    expect(matchReplyToOutbound({ ...reply, subject: "Research brief: heat pumps" }, [outbound()])).toBeNull();
  });

  it("does not match a subject sent to someone else", () => {
    expect(matchReplyToOutbound(reply, [outbound({ toAddresses: ["bob@example.com"] })])).toBeNull();
  });

  it("does not match a subject outside the window or sent after the reply", () => {
    const tooOld = new Date(reply.receivedAt.getTime() - REPLY_SUBJECT_MATCH_WINDOW_MS - 60_000);
    expect(matchReplyToOutbound(reply, [outbound({ createdAt: tooOld.toISOString() })])).toBeNull();
    expect(matchReplyToOutbound(reply, [outbound({ createdAt: "2026-09-12T00:00:00.000Z" })])).toBeNull();
  });
});

describe("stripQuotedReply", () => {
  it("cuts at a Gmail attribution wrapped over two lines", () => {
    const text = [
      "Can you compare two brands?",
      "",
      "On Thu, Sep 10, 2026 at 12:00 PM Jarvis <",
      "agent@example.com> wrote:",
      "> Here is the brief.",
    ].join("\n");
    expect(stripQuotedReply(text)).toBe("Can you compare two brands?");
  });

  it("cuts at an Original Message rule or quoted lines", () => {
    expect(stripQuotedReply("Yes.\n-----Original Message-----\nFrom: x")).toBe("Yes.");
    expect(stripQuotedReply("Yes.\n> quoted")).toBe("Yes.");
    expect(stripQuotedReply("Yes.\n________________________________\nFrom: x")).toBe("Yes.");
  });

  it("keeps a line that starts with On but is not an attribution", () => {
    expect(stripQuotedReply("On second thought, skip it.\nThanks")).toBe(
      "On second thought, skip it.\nThanks",
    );
  });

  it("keeps the whole text when nothing is above the quote", () => {
    expect(stripQuotedReply("> only quoted")).toBe("> only quoted");
  });
});
