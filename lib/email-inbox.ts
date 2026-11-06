import { appConfig } from "@/app.config";
import { senderPassesDmarc } from "@/lib/email-auth";
import {
  classifyEmailAction,
  emailActionSessionPrompt,
  type EmailActionClassification,
} from "@/lib/email-classify";
import {
  emailBodyForEmbedding,
  emailHasCompleteBodies,
  fetchReceivedEmailContent,
  normalizeEmailBodies,
  receivedAuthenticationResults,
  receivedThreadHeaders,
} from "@/lib/email-content";
import { EMAIL_EMBEDDING_KINDS, EMAIL_SEARCH_MIN_SCORE, persistEmailEmbeddings } from "@/lib/email-embeddings";
import { emailReplyHandoffPrompt, emailReplyTurnPrompt } from "@/lib/email-reply-prompt";
import { ensureSentMessageId } from "@/lib/email-send";
import {
  matchReplyToOutbound,
  normalizeMessageId,
  REPLY_MATCH_CANDIDATE_LIMIT,
  REPLY_SUBJECT_MATCH_WINDOW_MS,
  replyParentIds,
  type ReplyMatch,
  type ReplyThreadHeaders,
} from "@/lib/email-thread";
import {
  findUserById,
  inboundMailOwner,
  normalizeEmailAddress,
  parseAddressList,
} from "@/lib/email-users";
import { appOrigin, internalDispatchSecret } from "@/lib/internal-auth";
import { isAgentRecipient } from "@/lib/resend";
import { embedTexts } from "@/lib/embeddings";
import {
  createChat,
  deleteChat,
  createEmail,
  createJob,
  getChat,
  getEmail,
  getEmailByResendId,
  listEmails,
  searchUserEmbeddings,
  titleFromPrompt,
  updateChat,
  updateEmail,
} from "@/lib/store";
import { agentResendInboxActive, getInboxThreadEmail, isAgentResendInbox } from "@/lib/resend-inbox";
import { remindFollowThroughPrompt } from "@/lib/schedule-prompt";
import { runWithUsageScope } from "@/lib/usage-scope";
import type { ChatRecord, EmailDirection, EmailRecord, EmailSearchHit } from "@/lib/types";

export type InboundEmailPayload = {
  emailId?: string;
  from?: string;
  to?: string[] | string;
  cc?: string[] | string;
  receivedFor?: string[] | string;
  subject?: string;
  attachments?: {
    filename?: string | null;
    content_type?: string;
    contentType?: string;
    size?: number;
  }[];
};

export async function searchUserInbox(
  userId: string,
  query: string,
  options?: { direction?: EmailDirection; limit?: number },
): Promise<EmailSearchHit[]> {
  const trimmed = query.trim();
  const limit = options?.limit ?? 40;
  const emails = await listEmails(userId, { direction: options?.direction, limit: 200 });
  if (!trimmed) {
    return emails.slice(0, limit).map((email) => ({ email, score: 1, match: "subject" as const }));
  }

  const needle = trimmed.toLowerCase();
  const hits = new Map<string, EmailSearchHit>();
  const remember = (hit: EmailSearchHit) => {
    const existing = hits.get(hit.email.id);
    if (!existing || hit.score > existing.score) hits.set(hit.email.id, hit);
  };

  for (const email of emails) {
    const subject = email.subject.toLowerCase();
    const body = emailBodyForEmbedding(email).toLowerCase();
    const people = [email.fromAddress, ...email.toAddresses].join(" ").toLowerCase();
    let score = 0;
    let match: EmailSearchHit["match"] = "similar";
    if (subject === needle) {
      score = 0.98;
      match = "subject";
    } else if (subject.includes(needle)) {
      score = 0.9;
      match = "subject";
    } else if (people.includes(needle)) {
      score = 0.78;
      match = "subject";
    } else if (body.includes(needle)) {
      score = 0.72;
      match = "body";
    }
    if (score > 0) remember({ email, score, match });
  }

  try {
    const [embedding] = await runWithUsageScope({ userId }, () => embedTexts([trimmed]));
    if (embedding) {
      const semantic = await searchUserEmbeddings({
        userId,
        queryEmbeddings: [embedding],
        kinds: EMAIL_EMBEDDING_KINDS,
        includeSourceIds: emails.map((email) => email.id),
        limit: Math.max(limit * 2, 24),
        minScore: EMAIL_SEARCH_MIN_SCORE,
      });
      for (const hit of semantic) {
        const email = emails.find((row) => row.id === hit.record.sourceId);
        if (!email) continue;
        remember({
          email,
          score: hit.score,
          match: hit.record.kind === "email_body" ? "body" : "similar",
        });
      }
    }
  } catch (error) {
    console.error("[email] search embedding failed", error);
  }

  return [...hits.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

export function toClientEmail(
  email: EmailRecord,
  options?: { includeBodies?: boolean; bodyPreviewChars?: number },
) {
  const includeBodies = options?.includeBodies ?? true;
  const previewChars = options?.bodyPreviewChars ?? 1_500;
  return {
    ...email,
    href: `/inbox/${email.id}`,
    sessionHref: email.chatId ? `/s/${email.chatId}` : null,
    bodyText: includeBodies ? email.bodyText : emailBodyForEmbedding(email).slice(0, previewChars),
    bodyHtml: includeBodies ? email.bodyHtml : "",
  };
}

/**
 * "started": the session is running. "maybe": the request may have started it
 * (timeout, network error, 5xx), and the email route records the session id on
 * the chat itself in that case. "not-started": it definitely did not run.
 */
type EmailSessionStart =
  | { status: "started"; sessionId: string }
  | { status: "maybe" }
  | { status: "not-started" };

async function startEmailSessionNow(
  email: EmailRecord,
  prompt: string,
  chatId: string,
  continueSessionId?: string,
): Promise<EmailSessionStart> {
  const secret = internalDispatchSecret();
  const origin = appOrigin();
  if (!secret) return { status: "not-started" };
  const owner = await findUserById(email.userId);
  try {
    const response = await fetch(`${origin}/api/internal/email-sessions`, {
      signal: AbortSignal.timeout(8_000),
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-email-session-secret": secret,
      },
      body: JSON.stringify({
        userId: email.userId,
        prompt,
        email: owner?.email,
        name: owner?.name,
        chatId,
        ...(continueSessionId ? { continueSessionId } : {}),
      }),
    });
    if (!response.ok) {
      console.error("[email] immediate session start returned", response.status);
      return response.status >= 500 ? { status: "maybe" } : { status: "not-started" };
    }
    const payload = (await response.json().catch(() => ({}))) as { sessionId?: string };
    const sessionId = payload.sessionId?.trim();
    return sessionId ? { status: "started", sessionId } : { status: "maybe" };
  } catch (error) {
    console.error("[email] immediate session start failed", error);
    return { status: "maybe" };
  }
}

/** Start an email-sourced session. Callers must not use inbound From as authorization. */
export async function startEmailActionSession(email: EmailRecord, prompt: string): Promise<string | null> {
  const chat = await createChat(
    email.userId,
    titleFromPrompt(email.actionSummary || email.subject || prompt),
    "email",
  );
  const start = await startEmailSessionNow(email, prompt, chat.id);
  if (start.status === "started") {
    await updateChat(email.userId, chat.id, { sessionId: start.sessionId });
    await updateEmail(email.userId, email.id, { chatId: chat.id, status: "processed" });
    return chat.id;
  }

  // Could not confirm the start (timeout, cold start, deploy). Queue a /remind
  // follow-through instead of a plain nudge: a nudge only pings the user, and
  // /remind checks prior sessions first, so a start that did go through is
  // not repeated.
  await createJob(email.userId, {
    prompt: remindFollowThroughPrompt(prompt),
    firstRunAt: new Date().toISOString(),
    everyMinutes: null,
    authenticator: "better-auth",
    issuer: null,
  });
  if (start.status === "maybe") {
    // The session may be running on this chat (the email route records its id),
    // so keep the chat and link it rather than lose that history.
    await updateEmail(email.userId, email.id, { chatId: chat.id, status: "processed" });
    return chat.id;
  }
  // Nothing started; the scheduler opens its own session, so drop this empty chat.
  await deleteChat(email.userId, chat.id);
  await updateEmail(email.userId, email.id, { status: "processed" });
  return null;
}

function webhookAttachments(eventData: InboundEmailPayload): EmailRecord["attachments"] {
  return (eventData.attachments ?? []).map((attachment) => ({
    filename: attachment.filename || "attachment",
    contentType: attachment.contentType || attachment.content_type || "application/octet-stream",
    size: typeof attachment.size === "number" ? attachment.size : null,
  }));
}

async function backfillStoredEmailBodies(email: EmailRecord, resendEmailId: string | undefined): Promise<EmailRecord> {
  const derived = normalizeEmailBodies({ html: email.bodyHtml, text: email.bodyText });
  if (emailHasCompleteBodies(derived)) {
    const updated =
      (await updateEmail(email.userId, email.id, {
        bodyText: derived.bodyText,
        bodyHtml: derived.bodyHtml,
      })) ?? { ...email, ...derived };
    await persistEmailEmbeddings(updated);
    return updated;
  }
  if (!resendEmailId) return email;

  const content = await fetchReceivedEmailContent(resendEmailId);
  const updated =
    (await updateEmail(email.userId, email.id, {
      bodyText: content.bodyText,
      bodyHtml: content.bodyHtml,
    })) ?? { ...email, bodyText: content.bodyText, bodyHtml: content.bodyHtml };
  await persistEmailEmbeddings(updated);
  return updated;
}

export async function ensureStoredEmailContent(email: EmailRecord): Promise<EmailRecord> {
  if (emailHasCompleteBodies(email) || !email.resendEmailId) return email;
  try {
    return await backfillStoredEmailBodies(email, email.resendEmailId);
  } catch (error) {
    console.error("[email] body backfill failed", { emailId: email.id, error });
    return email;
  }
}

/**
 * Only mail an account sent itself may start an unattended session. The
 * agent address is not secret and From is easy to forge, so by default the
 * message must also pass DMARC for its From domain.
 */
async function mayStartUnattendedSession(
  fromAccount: boolean,
  fromAddress: string,
  resendEmailId: string,
): Promise<boolean> {
  if (!fromAccount) return false;
  if (!appConfig.security.emailSessionsRequireDmarc) return true;
  const results = await receivedAuthenticationResults(resendEmailId).catch((error: unknown) => {
    console.error("[email] could not read sender authentication", error);
    return null;
  });
  if (senderPassesDmarc(results, fromAddress)) return true;
  console.info("[email] no session: the sender did not pass DMARC", {
    fromAddress,
    verdict: results === null ? "no raw message" : results[0] ? "fail" : "no Authentication-Results",
  });
  return false;
}

/** The agent email an authorized reply answers, and the chat that sent it. */
export type RepliedAgentEmail = ReplyMatch & { readonly chat: ChatRecord };

/** Recent agent mail whose Message-ID Resend had not reported when it was sent. */
const MESSAGE_ID_BACKFILL_LIMIT = 5;

/**
 * Match an inbound email to the agent email it replies to: In-Reply-To /
 * References against stored Message-IDs, else a "Re:" subject sent to the
 * same address recently. Callers must have authorized the sender already.
 */
export async function findRepliedAgentEmail(
  email: EmailRecord,
  thread: ReplyThreadHeaders | null,
): Promise<RepliedAgentEmail | null> {
  const input = {
    inReplyTo: thread?.inReplyTo ?? (email.inReplyTo ? [email.inReplyTo] : []),
    references: thread?.references ?? [],
    subject: email.subject,
    fromAddress: email.fromAddress,
    receivedAt: new Date(email.createdAt),
  };
  let outbound = await listEmails(email.userId, {
    direction: "outbound",
    limit: REPLY_MATCH_CANDIDATE_LIMIT,
  });
  let match = matchReplyToOutbound(input, outbound);

  if (match?.matchedBy !== "headers" && replyParentIds(input).length > 0) {
    // The reply names a Message-ID we may not have stored yet (no email.sent
    // webhook, or Resend had not handed the mail off at send time).
    const received = input.receivedAt.getTime();
    const missing = outbound
      .filter(
        (row) =>
          row.chatId &&
          !row.messageId &&
          row.resendEmailId &&
          received - Date.parse(row.createdAt) <= REPLY_SUBJECT_MATCH_WINDOW_MS,
      )
      .slice(0, MESSAGE_ID_BACKFILL_LIMIT);
    if (missing.length > 0) {
      const filled = new Map(
        (await Promise.all(missing.map((row) => ensureSentMessageId(row)))).map((row) => [row.id, row]),
      );
      outbound = outbound.map((row) => filled.get(row.id) ?? row);
      match = matchReplyToOutbound(input, outbound);
    }
  }
  if (!match?.email.chatId) return null;
  const chat = await getChat(email.userId, match.email.chatId);
  return chat ? { ...match, chat } : null;
}

/**
 * Only a chat that email started may be continued by email. A chat started
 * on the web (or by a schedule) is used on the web only; a reply to its mail
 * opens a new email chat that links back to it instead.
 */
export function chatAcceptsEmailTurns(chat: Pick<ChatRecord, "source" | "sessionId">): boolean {
  return chat.source === "email" && Boolean(chat.sessionId);
}

/**
 * Send an emailed reply into the email chat session that wrote the email it
 * answers. True when that session took the turn (or may have, after a
 * timeout); false when it cannot or may not continue and the caller should
 * start a new session instead.
 */
async function continueRepliedChat(
  email: EmailRecord,
  replied: RepliedAgentEmail,
  prompt: string,
): Promise<boolean> {
  const sessionId = replied.chat.sessionId;
  if (!sessionId || !chatAcceptsEmailTurns(replied.chat)) return false;
  const start = await startEmailSessionNow(email, prompt, replied.chat.id, sessionId);
  if (start.status === "not-started") return false;
  await updateEmail(email.userId, email.id, { chatId: replied.chat.id, status: "processed" });
  if (start.status === "maybe") {
    // Unconfirmed: queue a /remind follow-through, which checks prior sessions
    // before acting, as for a new email session.
    await createJob(email.userId, {
      prompt: remindFollowThroughPrompt(prompt),
      firstRunAt: new Date().toISOString(),
      everyMinutes: null,
      authenticator: "better-auth",
      issuer: null,
    });
  }
  return true;
}

function withNote(prompt: string, note: string | undefined): string {
  return note ? `${prompt}\n${note}` : prompt;
}

/**
 * Handle an authorized email: a reply to agent mail continues the chat that
 * sent it; anything else starts a session when it asks for something.
 */
async function startActionSessionIfRequested(
  email: EmailRecord,
  options: { threadNote?: string; thread: ReplyThreadHeaders | null },
) {
  const replied = await findRepliedAgentEmail(email, options.thread).catch((error: unknown) => {
    console.error("[email] reply matching failed", { emailId: email.id, error });
    return null;
  });
  const action = await classifyEmailAction(email);
  if (!action.hasActionItem) {
    // Nothing to do, but file the reply with its conversation.
    if (replied) await updateEmail(email.userId, email.id, { chatId: replied.chat.id });
    return;
  }

  const withAction =
    (await updateEmail(email.userId, email.id, {
      hasActionItem: true,
      actionSummary: action.summary || action.prompt || email.subject || "Email to agent",
    })) ?? email;
  const classified: EmailActionClassification = {
    hasActionItem: true,
    summary: action.summary || action.prompt || withAction.actionSummary || "",
    prompt: action.prompt || action.summary || "Complete the request in this email.",
  };

  if (replied) {
    const continued = await continueRepliedChat(
      withAction,
      replied,
      withNote(emailReplyTurnPrompt(withAction, replied.email, classified), options.threadNote),
    );
    if (continued) return;
    await startEmailActionSession(
      withAction,
      withNote(
        emailReplyHandoffPrompt(withAction, replied.email, classified, {
          reason: replied.chat.source === "email" ? "unavailable" : "web-only",
        }),
        options.threadNote,
      ),
    );
    return;
  }

  await startEmailActionSession(
    withAction,
    withNote(emailActionSessionPrompt(withAction, classified), options.threadNote),
  );
}

/** In-Reply-To / References for an authorized email, from the header map or the raw message. */
async function threadHeadersFor(
  resendEmailId: string,
  known: ReplyThreadHeaders | null,
): Promise<ReplyThreadHeaders | null> {
  if (known && (known.inReplyTo.length > 0 || known.references.length > 0)) return known;
  return receivedThreadHeaders(resendEmailId).catch((error: unknown) => {
    console.error("[email] could not read thread headers", error);
    return known;
  });
}

/**
 * `email.received` for the agent address (`RESEND_FROM_EMAIL`). The mail is
 * stored for the account that sent it, or for the workspace owner, and is
 * searchable from the Inbox page and the agent's email tools.
 */
export async function processInboundResendEmail(eventData: InboundEmailPayload): Promise<EmailRecord | null> {
  const resendEmailId = eventData.emailId?.trim();
  if (resendEmailId) {
    const existing = await getEmailByResendId(resendEmailId);
    if (existing) {
      return emailHasCompleteBodies(existing)
        ? existing
        : backfillStoredEmailBodies(existing, resendEmailId);
    }
  }

  const toAddresses = parseAddressList(eventData.to);
  const ccAddresses = parseAddressList(eventData.cc);
  const receivedFor = parseAddressList(eventData.receivedFor);
  const recipients = [...new Set([...toAddresses, ...ccAddresses, ...receivedFor])];
  if (!isAgentRecipient(recipients)) {
    console.info("[email] inbound ignored; not addressed to the agent", { recipients });
    return null;
  }
  // With a Resend inbox on the agent address, its inbox.email.received event
  // carries this mail, so handling it here too would store it twice.
  if (await agentResendInboxActive()) return null;

  if (!resendEmailId) {
    console.error("[email] inbound missing Resend email id; cannot fetch body");
    return null;
  }

  const content = await fetchReceivedEmailContent(resendEmailId);
  const fromAddress = normalizeEmailAddress(content.from || eventData.from || "");
  const owner = await inboundMailOwner(fromAddress);
  if (!owner) {
    console.info("[email] inbound ignored; no account yet");
    return null;
  }
  const storedTo = content.to.length > 0 ? content.to : toAddresses;
  const storedCc = content.cc.length > 0 ? content.cc : ccAddresses;

  let email: EmailRecord;
  try {
    email = await createEmail({
      userId: owner.user.id,
      direction: "inbound",
      fromAddress: fromAddress || "unknown",
      toAddresses: storedTo,
      ccAddresses: storedCc,
      subject: content.subject || eventData.subject?.trim() || "",
      bodyText: content.bodyText,
      bodyHtml: content.bodyHtml,
      resendEmailId,
      status: "received",
      hasActionItem: false,
      actionSummary: null,
      chatId: null,
      inReplyTo: content.inReplyTo[0] ?? null,
      messageId: content.messageId,
      attachments: content.attachments.length > 0 ? content.attachments : webhookAttachments(eventData),
    });
  } catch (error) {
    // A concurrent delivery of the same event won the unique insert.
    const existing = await getEmailByResendId(resendEmailId);
    if (existing) return existing;
    throw error;
  }
  await persistEmailEmbeddings(email);
  if (await mayStartUnattendedSession(owner.fromAccount, fromAddress, resendEmailId)) {
    await startActionSessionIfRequested(email, {
      thread: await threadHeadersFor(resendEmailId, {
        inReplyTo: content.inReplyTo,
        references: content.references,
      }),
    });
  }
  return (await getEmail(owner.user.id, email.id)) ?? email;
}

export type InboxEmailReceivedPayload = {
  inboxId: string;
  threadId: string;
  emailId: string;
  direction?: "inbound" | "outbound";
};

/**
 * `inbox.email.received` from the agent's Resend inbox. Stored like any
 * inbound email; the same rule decides whether it may start a session, and
 * that session is told the thread so it replies there.
 */
export async function processInboxEmailReceived(
  payload: InboxEmailReceivedPayload,
): Promise<EmailRecord | null> {
  if (payload.direction === "outbound") return null;
  const existing = await getEmailByResendId(payload.emailId);
  if (existing) return existing;
  if (!(await isAgentResendInbox(payload.inboxId))) {
    console.info("[email] inbox mail ignored; not the agent's inbox", { inboxId: payload.inboxId });
    return null;
  }

  const message = await getInboxThreadEmail(payload.inboxId, payload.threadId, payload.emailId);
  if (message.direction === "outbound") return null;
  const fromAddress = normalizeEmailAddress(message.from);
  const owner = await inboundMailOwner(fromAddress);
  if (!owner) {
    console.info("[email] inbox mail ignored; no account yet");
    return null;
  }
  const bodies = normalizeEmailBodies({ html: message.html ?? "", text: message.text ?? "" });

  let email: EmailRecord;
  try {
    email = await createEmail({
      userId: owner.user.id,
      direction: "inbound",
      fromAddress: fromAddress || "unknown",
      toAddresses: parseAddressList(message.to),
      ccAddresses: parseAddressList(message.cc),
      subject: message.subject?.trim() || "",
      bodyText: bodies.bodyText,
      bodyHtml: bodies.bodyHtml,
      resendEmailId: payload.emailId,
      status: "received",
      hasActionItem: false,
      actionSummary: null,
      chatId: null,
      inReplyTo: null,
      messageId: normalizeMessageId(message.message_id),
      attachments: message.attachments.map((attachment) => ({
        filename: attachment.filename || "attachment",
        contentType: "application/octet-stream",
        size: attachment.size,
      })),
    });
  } catch (error) {
    const raced = await getEmailByResendId(payload.emailId);
    if (raced) return raced;
    throw error;
  }
  await persistEmailEmbeddings(email);

  if (await mayStartUnattendedSession(owner.fromAccount, fromAddress, payload.emailId)) {
    await startActionSessionIfRequested(email, {
      threadNote: `This email is in the agent's Resend inbox (thread ${payload.threadId}, email ${payload.emailId}). To answer in that thread, use inbox_reply with this threadId instead of send_email.`,
      thread: await threadHeadersFor(payload.emailId, null),
    });
  }
  return (await getEmail(owner.user.id, email.id)) ?? email;
}
