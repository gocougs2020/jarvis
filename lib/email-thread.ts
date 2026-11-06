import { normalizeEmailAddress } from "@/lib/email-users";
import type { EmailRecord } from "@/lib/types";

/** How far back a subject-only match may reach for the agent email being answered. */
export const REPLY_SUBJECT_MATCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Outbound candidates a reply is matched against (newest first). */
export const REPLY_MATCH_CANDIDATE_LIMIT = 200;

/**
 * A Message-ID without its angle brackets, lowercased so header spellings
 * compare equal. Null unless it is one `local@domain` token: no whitespace or
 * brackets, so a value that reaches an outgoing header cannot inject another.
 */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  if (!trimmed || !/^[^\s<>@]+@[^\s<>@]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Message-IDs in an In-Reply-To or References value, in header order. Accepts
 * the raw header (`<a@x> <b@y>`), a list, or a bare id.
 */
export function parseMessageIds(value: string | readonly string[] | null | undefined): string[] {
  if (!value) return [];
  const raw = typeof value === "string" ? [value] : value;
  const ids: string[] = [];
  for (const entry of raw) {
    const bracketed = entry.match(/<[^<>\s]+>/g);
    const tokens = bracketed ?? entry.split(/[\s,]+/);
    for (const token of tokens) {
      const id = normalizeMessageId(token);
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Angle-bracketed form for an outgoing header. */
export function messageIdHeader(id: string): string {
  return `<${id.replace(/^<+/, "").replace(/>+$/, "")}>`;
}

const REPLY_PREFIX = /^\s*(?:re|aw|sv|antw|vs|r)(?:\s*\[\d+\])?\s*:\s*/i;

/** True when a subject reads as a reply ("Re: …", "RE[2]: …", "AW: …"). */
export function isReplySubject(subject: string | null | undefined): boolean {
  return REPLY_PREFIX.test(subject ?? "");
}

/** Subject with every leading reply prefix removed, lowercased, whitespace collapsed. */
export function normalizeReplySubject(subject: string | null | undefined): string {
  let value = subject ?? "";
  while (REPLY_PREFIX.test(value)) value = value.replace(REPLY_PREFIX, "");
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export type ReplyThreadHeaders = {
  readonly inReplyTo: readonly string[];
  readonly references: readonly string[];
};

export type ReplyMatchInput = ReplyThreadHeaders & {
  readonly subject: string;
  /** The owner address the reply came from (already authorized by the caller). */
  readonly fromAddress: string;
  readonly receivedAt: Date;
};

export type ReplyMatch = {
  readonly email: EmailRecord;
  readonly matchedBy: "headers" | "subject";
};

/**
 * Message-IDs a reply points at, most specific first: In-Reply-To, then
 * References from the newest (last) entry back to the thread root.
 */
export function replyParentIds(headers: ReplyThreadHeaders): string[] {
  const ids: string[] = [];
  for (const id of [...headers.inReplyTo, ...[...headers.references].reverse()]) {
    const normalized = normalizeMessageId(id);
    if (normalized && !ids.includes(normalized)) ids.push(normalized);
  }
  return ids;
}

function sentTo(email: EmailRecord, address: string): boolean {
  if (!address) return false;
  return [...email.toAddresses, ...email.ccAddresses].some(
    (recipient) => normalizeEmailAddress(recipient) === address,
  );
}

/**
 * The agent email a reply answers, among `outbound` (one account's sent mail).
 * Only mail that a session sent (`chatId`) can be continued.
 *
 * 1. In-Reply-To / References naming a stored Message-ID.
 * 2. Otherwise a "Re:" subject equal to a recent agent email sent to the same
 *    address the reply came from; the newest such email wins.
 */
export function matchReplyToOutbound(
  input: ReplyMatchInput,
  outbound: readonly EmailRecord[],
): ReplyMatch | null {
  const sessionMail = outbound.filter((email) => email.direction === "outbound" && email.chatId);

  for (const id of replyParentIds(input)) {
    const email = sessionMail.find((row) => normalizeMessageId(row.messageId) === id);
    if (email) return { email, matchedBy: "headers" };
  }

  if (!isReplySubject(input.subject)) return null;
  const subject = normalizeReplySubject(input.subject);
  if (!subject) return null;
  const from = normalizeEmailAddress(input.fromAddress);
  const received = input.receivedAt.getTime();
  const candidates = sessionMail
    .filter((email) => {
      if (normalizeReplySubject(email.subject) !== subject) return false;
      if (!sentTo(email, from)) return false;
      const sent = Date.parse(email.createdAt);
      if (!Number.isFinite(sent)) return false;
      return sent <= received && received - sent <= REPLY_SUBJECT_MATCH_WINDOW_MS;
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return candidates[0] ? { email: candidates[0], matchedBy: "subject" } : null;
}

const ATTRIBUTION_LINE = /^\s*On\b[\s\S]{0,300}\bwrote:\s*$/i;
const ORIGINAL_MESSAGE_LINE = /^\s*-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}\s*$/i;
const OUTLOOK_RULE_LINE = /^\s*_{10,}\s*$/;

/**
 * The new text of a reply, without the quoted message under it: cut at the
 * client's attribution ("On … wrote:", which Gmail may wrap over a few
 * lines), an "Original Message" or Outlook rule line, or a run of `>` lines.
 * Returns the whole text when nothing new remains above the quote.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let cut = lines.length;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (ORIGINAL_MESSAGE_LINE.test(line) || OUTLOOK_RULE_LINE.test(line)) {
      cut = index;
      break;
    }
    if (/^\s*>/.test(line)) {
      cut = index;
      break;
    }
    if (/^\s*On\b/i.test(line)) {
      const joined = lines.slice(index, index + 3);
      const span = joined.findIndex((_, end) => ATTRIBUTION_LINE.test(joined.slice(0, end + 1).join(" ")));
      if (span >= 0) {
        cut = index;
        break;
      }
    }
  }
  const fresh = lines.slice(0, cut).join("\n").trim();
  return fresh || text.trim();
}
