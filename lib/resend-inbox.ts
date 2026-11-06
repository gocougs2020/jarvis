import type { Inbox, InboxLabel, InboxMessage, InboxThread } from "resend";
import { appConfig, type AppConfig } from "@/app.config";
import { APP_NAME } from "@/lib/brand";
import { htmlToText } from "@/lib/email-content";
import { normalizeEmailAddress } from "@/lib/email-users";
import {
  formatInboundMailToken,
  inboundMailboxAddress,
  isInboundMailToken,
  normalizeInboundMailToken,
} from "@/lib/inbound-mail-token";
import { getResend, resendConfigured } from "@/lib/resend";
import { findUserIdByInboundMailToken, getUserSettings } from "@/lib/store";

/**
 * Resend Inboxes: each user can host their agent address as a Resend Inbox,
 * which stores threads, labels, and drafts. The address carries the user's
 * existing secret token (Inbox addresses cannot use a `+` tag), so it stays
 * unguessable, rotates with the token, and maps back to its owner without a
 * lookup table: `agent-abcde-fghij@example.com`.
 */

export class ResendInboxError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ResendInboxError";
    this.status = status;
  }
}

type SdkResponse<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string; statusCode: number | null } };

function unwrap<T>(response: SdkResponse<T>): T {
  if (response.error) {
    throw new ResendInboxError(response.error.message, response.error.statusCode);
  }
  return response.data;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ResendInboxError && error.status === 404;
}

/** On in app.config.ts, Resend has an API key, and there is a receiving mailbox to derive addresses from. */
export function resendInboxAvailable(): boolean {
  return appConfig.resendInbox.enabled && resendConfigured() && Boolean(inboundMailboxAddress());
}

function splitMailbox(mailbox: string | null): { local: string; domain: string } | null {
  if (!mailbox) return null;
  const email = normalizeEmailAddress(mailbox);
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  const local = (email.slice(0, at).split("+")[0] ?? "").trim();
  const domain = email.slice(at + 1).trim();
  return local && domain ? { local, domain } : null;
}

/** The user's Resend Inbox address for this token, on the app's receiving mailbox domain. */
export function resendInboxAddress(
  token: string,
  mailbox: string | null = inboundMailboxAddress(),
): string | null {
  const parts = splitMailbox(mailbox);
  if (!parts || !isInboundMailToken(token)) return null;
  return `${parts.local}-${formatInboundMailToken(token)}@${parts.domain}`;
}

/** The secret token in a Resend Inbox address, or null when it is not one of this app's. */
export function inboundTokenFromInboxAddress(
  address: string,
  mailbox: string | null = inboundMailboxAddress(),
): string | null {
  const parts = splitMailbox(mailbox);
  if (!parts) return null;
  const email = normalizeEmailAddress(address);
  const at = email.lastIndexOf("@");
  if (at <= 0 || email.slice(at + 1) !== parts.domain) return null;
  const local = email.slice(0, at);
  const prefix = `${parts.local}-`;
  if (!local.startsWith(prefix)) return null;
  const token = normalizeInboundMailToken(local.slice(prefix.length));
  return isInboundMailToken(token) ? token : null;
}

export type UserResendInbox = {
  readonly id: string;
  readonly address: string;
  readonly unread: number;
};

function toUserInbox(inbox: Inbox): UserResendInbox {
  return { id: inbox.id, address: inbox.email_address, unread: inbox.unread };
}

async function userInboxAddress(userId: string): Promise<string | null> {
  const settings = await getUserSettings(userId);
  return settings.inboundMailToken ? resendInboxAddress(settings.inboundMailToken) : null;
}

/** The user's Resend Inbox, or null when they have not turned it on (or it is unavailable). */
export async function getUserResendInbox(userId: string): Promise<UserResendInbox | null> {
  if (!resendInboxAvailable()) return null;
  const address = await userInboxAddress(userId);
  if (!address) return null;
  try {
    return toUserInbox(unwrap(await getResend().inboxes.get(address)));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Point Resend's built-in inbox agent at the triage instructions from app.config.ts. */
async function configureTriageAgent(inboxId: string): Promise<void> {
  // Widened so a fork can empty the list without a type error here.
  const { triageInstructions, triageTone } = appConfig.resendInbox;
  const triageActions: AppConfig["resendInbox"]["triageActions"] = appConfig.resendInbox.triageActions;
  const instructions = triageInstructions.trim().slice(0, 4_000);
  if (!instructions || triageActions.length === 0) return;
  unwrap(
    await getResend().inboxes.agent.update({
      actions: [...triageActions],
      inboxId,
      instructions,
      tone: triageTone,
    }),
  );
}

/** Create the user's inbox at their token address (idempotent). */
export async function ensureUserResendInbox(
  userId: string,
  owner?: { email?: string | null; name?: string | null },
): Promise<UserResendInbox> {
  if (!resendInboxAvailable()) {
    throw new ResendInboxError("Resend Inboxes are not available on this deployment.");
  }
  const existing = await getUserResendInbox(userId);
  if (existing) return existing;
  const address = await userInboxAddress(userId);
  if (!address) throw new ResendInboxError("No agent address is set for this account.");
  const label = owner?.name?.trim() || owner?.email?.trim() || userId;
  const created = unwrap(
    await getResend().inboxes.create({
      emailAddress: address,
      fromName: APP_NAME.replace(/[:<>\r\n]/g, "").slice(0, 78),
      name: `${APP_NAME} · ${label}`.slice(0, 64),
    }),
  );
  try {
    await configureTriageAgent(created.id);
  } catch (error) {
    // The inbox works without triage; Settings can be retried later.
    console.error("[resend-inbox] triage agent setup failed", error);
  }
  return { address, id: created.id, unread: 0 };
}

/** Owner of a Resend Inbox, from the secret token in its address. */
export async function userIdForResendInbox(inboxId: string): Promise<string | null> {
  try {
    const inbox = unwrap(await getResend().inboxes.get(inboxId));
    const token = inboundTokenFromInboxAddress(inbox.email_address);
    return token ? await findUserIdByInboundMailToken(token) : null;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** The user's inbox, or an error the agent can relay. */
export async function requireUserResendInbox(userId: string): Promise<UserResendInbox> {
  if (!resendInboxAvailable()) {
    throw new ResendInboxError(
      "Resend Inboxes are off for this deployment. Use list_emails and read_email for stored mail.",
    );
  }
  const inbox = await getUserResendInbox(userId);
  if (!inbox) {
    throw new ResendInboxError(
      "The user has not turned on their Resend inbox. They can turn it on in Settings → Inbox. Use list_emails and read_email for stored mail meanwhile.",
    );
  }
  return inbox;
}

/**
 * Resend IDs are interpolated into request paths unencoded by the SDK, so a
 * value with `/` or `..` could reach another inbox on the same API key.
 */
export const RESEND_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

function assertResendId(...ids: (string | undefined)[]): void {
  for (const id of ids) {
    if (id !== undefined && !RESEND_ID_PATTERN.test(id)) {
      throw new ResendInboxError("Invalid thread, email, or draft id.");
    }
  }
}

export const INBOX_FOLDERS = ["inbox", "archive", "spam", "sent", "trash"] as const;
export type InboxFolder = (typeof INBOX_FOLDERS)[number];
export const MOVABLE_INBOX_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;
export type MovableInboxFolder = (typeof MOVABLE_INBOX_FOLDERS)[number];

export type ThreadSummary = {
  readonly threadId: string;
  readonly subject: string;
  readonly from: string | null;
  readonly to: readonly string[];
  readonly labels: readonly string[];
  readonly folder: string;
  readonly read: boolean;
  readonly emailCount: number;
  readonly hasAttachment: boolean;
  readonly hasDraft: boolean;
  readonly receivedAt: string;
  readonly matchedEmailId?: string | null;
};

function toThreadSummary(thread: InboxThread & { matched_email_id?: string | null }): ThreadSummary {
  return {
    threadId: thread.id,
    subject: thread.subject ?? "(no subject)",
    from: thread.from,
    to: thread.to,
    labels: thread.labels.map((label) => label.name),
    folder: thread.folder,
    read: thread.read,
    emailCount: thread.email_count,
    hasAttachment: thread.has_attachment,
    hasDraft: thread.has_draft,
    receivedAt: thread.received_at,
    ...(thread.matched_email_id !== undefined ? { matchedEmailId: thread.matched_email_id } : {}),
  };
}

async function labelIdsByName(inboxId: string): Promise<Map<string, InboxLabel>> {
  const labels = unwrap(await getResend().inboxes.labels.list({ inboxId })).data;
  return new Map(labels.map((label) => [label.name.trim().toLowerCase(), label]));
}

export async function listInboxThreads(
  inboxId: string,
  options: {
    query?: string;
    folder?: InboxFolder;
    label?: string;
    unread?: boolean;
    from?: string;
    limit?: number;
  },
): Promise<ThreadSummary[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  let labels: string[] | undefined;
  if (options.label?.trim()) {
    const label = (await labelIdsByName(inboxId)).get(options.label.trim().toLowerCase());
    if (!label) return [];
    labels = [label.id];
  }
  const filters = {
    inboxId,
    limit,
    ...(options.folder ? { folders: [options.folder] } : {}),
    ...(labels ? { labels } : {}),
    ...(options.unread !== undefined ? { read: !options.unread } : {}),
  };
  const query = options.query?.trim();
  const from = options.from?.trim();
  const resend = getResend();
  const page =
    query || from
      ? unwrap(
          await resend.inboxes.threads.search({
            ...filters,
            ...(query ? { query } : {}),
            ...(from ? { from: [from] } : {}),
          }),
        )
      : unwrap(await resend.inboxes.threads.list(filters));
  return page.data.map(toThreadSummary);
}

const MAX_MESSAGE_CHARS = 8_000;

export type ThreadMessage = {
  readonly emailId: string;
  readonly direction: "inbound" | "outbound";
  readonly from: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly receivedAt: string;
  readonly text: string;
  readonly attachments: readonly string[];
};

export function inboxMessageText(message: Pick<InboxMessage, "html" | "text">): string {
  const text = message.text?.trim() || (message.html ? htmlToText(message.html) : "");
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n[…truncated]` : text;
}

function toThreadMessage(message: InboxMessage): ThreadMessage {
  return {
    emailId: message.id,
    direction: message.direction,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject ?? "",
    receivedAt: message.received_at,
    text: inboxMessageText(message),
    attachments: message.attachments.map((attachment) => attachment.filename ?? "attachment"),
  };
}

export async function readInboxThread(inboxId: string, threadId: string, limit = 25) {
  assertResendId(threadId);
  const resend = getResend();
  const [summary, emails, drafts] = await Promise.all([
    resend.inboxes.threads.get({ inboxId, threadId }).then(unwrap),
    resend.inboxes.threads.emails.list({ inboxId, threadId, limit: Math.min(limit, 100) }).then(unwrap),
    resend.inboxes.drafts.list({ inboxId, limit: 100 }).then(unwrap),
  ]);
  // Full text, so the agent can show the user exactly what a draft says.
  const threadDrafts = await Promise.all(
    drafts.data
      .filter((draft) => draft.thread_id === threadId)
      .slice(0, 5)
      .map((draft) => resend.inboxes.drafts.get({ draftId: draft.id, inboxId }).then(unwrap)),
  );
  return {
    threadId: summary.id,
    subject: summary.subject ?? "(no subject)",
    folder: summary.folder,
    read: summary.read,
    labels: summary.labels.map((label) => label.name),
    messages: emails.data.map(toThreadMessage),
    hasMoreMessages: emails.has_more,
    drafts: threadDrafts.map((draft) => ({
      draftId: draft.id,
      to: draft.to ?? [],
      subject: draft.subject ?? "",
      text: inboxMessageText(draft),
      replyToEmailId: draft.reply_to_email_id,
      updatedAt: draft.updated_at,
    })),
  };
}

/** Latest inbound message in a thread: the default target for a reply. */
export async function latestInboundEmailId(inboxId: string, threadId: string): Promise<string | null> {
  assertResendId(threadId);
  const emails = unwrap(
    await getResend().inboxes.threads.emails.list({ inboxId, threadId, limit: 100 }),
  ).data;
  const sorted = [...emails].sort((left, right) => right.received_at.localeCompare(left.received_at));
  return (sorted.find((email) => email.direction === "inbound") ?? sorted[0])?.id ?? null;
}

export async function replyInInboxThread(input: {
  inboxId: string;
  threadId: string;
  emailId: string;
  text: string;
  html?: string;
  cc?: readonly string[];
  replyAll?: boolean;
  idempotencyKey: string;
}): Promise<string> {
  assertResendId(input.threadId, input.emailId);
  const sent = unwrap(
    await getResend().inboxes.threads.emails.reply(
      {
        emailId: input.emailId,
        inboxId: input.inboxId,
        text: input.text,
        threadId: input.threadId,
        ...(input.html ? { html: input.html } : {}),
        ...(input.cc?.length ? { cc: [...input.cc] } : {}),
        ...(input.replyAll ? { replyAll: true } : {}),
      },
      { idempotencyKey: input.idempotencyKey.slice(0, 256) },
    ),
  );
  return sent.id;
}

export async function draftInboxReply(input: {
  inboxId: string;
  threadId: string;
  emailId: string;
  text: string;
  html?: string;
  idempotencyKey: string;
}): Promise<string> {
  assertResendId(input.threadId, input.emailId);
  const draft = unwrap(
    await getResend().inboxes.drafts.create(
      {
        inboxId: input.inboxId,
        replyToEmailId: input.emailId,
        text: input.text,
        threadId: input.threadId,
        ...(input.html ? { html: input.html } : {}),
      },
      { idempotencyKey: input.idempotencyKey.slice(0, 256) },
    ),
  );
  return draft.id;
}

/**
 * Send a draft's reply with the text the user approved. The draft object is
 * not sent: its recipients and body came from Resend's inbox agent reading
 * untrusted mail, and the approval showed neither. Instead this replies to
 * the message the draft answers, so recipients come from the thread exactly
 * as in a normal reply, then discards the draft.
 */
export async function sendInboxDraft(input: {
  inboxId: string;
  threadId: string;
  draftId: string;
  text: string;
  html?: string;
  replyAll?: boolean;
  idempotencyKey: string;
}): Promise<string> {
  assertResendId(input.threadId, input.draftId);
  const resend = getResend();
  const draft = unwrap(await resend.inboxes.drafts.get({ draftId: input.draftId, inboxId: input.inboxId }));
  if (draft.thread_id !== input.threadId || !draft.reply_to_email_id) {
    throw new ResendInboxError("That draft is not a reply in this thread.");
  }
  const sentId = await replyInInboxThread({
    emailId: draft.reply_to_email_id,
    html: input.html,
    idempotencyKey: input.idempotencyKey,
    inboxId: input.inboxId,
    replyAll: input.replyAll,
    text: input.text,
    threadId: input.threadId,
  });
  await resend.inboxes.drafts
    .remove({ draftId: input.draftId, inboxId: input.inboxId })
    .then(unwrap)
    .catch((error: unknown) => console.error("[resend-inbox] draft cleanup failed", error));
  return sentId;
}

/** Move, mark read, and add or remove labels by name. Missing labels are created. */
export async function organizeInboxThread(input: {
  inboxId: string;
  threadId: string;
  folder?: MovableInboxFolder;
  read?: boolean;
  addLabels?: readonly string[];
  removeLabels?: readonly string[];
}) {
  const resend = getResend();
  const { inboxId, threadId } = input;
  assertResendId(threadId);
  if (input.folder !== undefined || input.read !== undefined) {
    const patch =
      input.folder !== undefined
        ? { folder: input.folder, ...(input.read !== undefined ? { read: input.read } : {}) }
        : { read: input.read as boolean };
    unwrap(await resend.inboxes.threads.update({ inboxId, threadId, ...patch }));
  }
  const adding = (input.addLabels ?? []).map((name) => name.trim()).filter(Boolean);
  const removing = (input.removeLabels ?? []).map((name) => name.trim()).filter(Boolean);
  if (adding.length > 0 || removing.length > 0) {
    const byName = await labelIdsByName(inboxId);
    const addIds: string[] = [];
    for (const name of adding) {
      const existing = byName.get(name.toLowerCase());
      if (existing) {
        addIds.push(existing.id);
        continue;
      }
      const created = unwrap(await resend.inboxes.labels.create({ inboxId, name: name.slice(0, 64) }));
      addIds.push(created.id);
    }
    if (addIds.length > 0) {
      unwrap(await resend.inboxes.threads.labels.add({ inboxId, labels: addIds, threadId }));
    }
    for (const name of removing) {
      const label = byName.get(name.toLowerCase());
      if (!label) continue;
      unwrap(await resend.inboxes.threads.labels.remove({ inboxId, labelId: label.id, threadId }));
    }
  }
  const summary = unwrap(await resend.inboxes.threads.get({ inboxId, threadId }));
  return {
    threadId: summary.id,
    folder: summary.folder,
    read: summary.read,
    labels: summary.labels.map((label) => label.name),
  };
}

export async function getInboxThreadEmail(inboxId: string, threadId: string, emailId: string) {
  assertResendId(threadId, emailId);
  return unwrap(await getResend().inboxes.threads.emails.get({ emailId, inboxId, threadId }));
}
