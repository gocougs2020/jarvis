import { APP_NAME } from "@/lib/brand";
import { getDocumentBlob } from "@/lib/blob-store";
import { textToHtml } from "@/lib/email-content";
import { persistEmailEmbeddings } from "@/lib/email-embeddings";
import { chooseOutboundSender } from "@/lib/email-sender";
import { messageIdHeader, normalizeMessageId } from "@/lib/email-thread";
import { findUserById, parseAddressList } from "@/lib/email-users";
import { getResend, resendConfigured } from "@/lib/resend";
import {
  createEmail,
  getDocument,
  getEmail,
  getEmailByResendId,
  updateEmail,
} from "@/lib/store";
import type { EmailAttachmentMeta, EmailRecord } from "@/lib/types";

export type SendEmailInput = {
  userId: string;
  to: string | readonly string[];
  subject: string;
  body: string;
  html?: string;
  cc?: readonly string[];
  documentIds?: readonly string[];
  /** Stored email id, Resend/inbox email id, or Message-ID of the mail being answered. */
  inReplyTo?: string | null;
  chatId?: string | null;
  idempotencyKey: string;
};

async function documentAttachments(
  userId: string,
  documentIds: readonly string[] | undefined,
): Promise<{ filename: string; content: Buffer; contentType?: string }[]> {
  if (!documentIds?.length) return [];
  const attachments: { filename: string; content: Buffer; contentType?: string }[] = [];
  for (const documentId of documentIds) {
    const document = await getDocument(userId, documentId);
    if (!document) continue;
    const blob = await getDocumentBlob(document.blobUrl, document.blobPathname);
    if (!blob) continue;
    attachments.push({
      filename: document.filename,
      content: blob.buffer,
      contentType: blob.contentType ?? document.mimeType,
    });
  }
  return attachments;
}

/**
 * The Message-ID a reply should name in In-Reply-To. The agent passes the id
 * it knows (stored, Resend, or inbox email id); a bare Resend id is not a
 * Message-ID, so look the stored copy up. Null when no Message-ID is known.
 */
export async function resolveParentMessageId(
  userId: string,
  reference: string | null | undefined,
): Promise<string | null> {
  const value = reference?.trim();
  if (!value) return null;
  const parent =
    (await getEmail(userId, value)) ??
    (await getEmailByResendId(value).then((email) => (email?.userId === userId ? email : null)));
  if (parent) return parent.messageId ?? null;
  return value.includes("@") ? normalizeMessageId(value) : null;
}

/** Resend's Message-ID for a sent email; null until Resend has handed it off. */
export async function fetchSentMessageId(resendEmailId: string): Promise<string | null> {
  const { data } = await getResend().emails.get(resendEmailId);
  return normalizeMessageId(data?.message_id);
}

/** Fill in an outbound email's Message-ID from Resend when it is not stored yet. */
export async function ensureSentMessageId(email: EmailRecord): Promise<EmailRecord> {
  if (email.direction !== "outbound" || email.messageId || !email.resendEmailId) return email;
  try {
    const messageId = await fetchSentMessageId(email.resendEmailId);
    if (!messageId) return email;
    return (await updateEmail(email.userId, email.id, { messageId })) ?? { ...email, messageId };
  } catch (error) {
    console.warn("[email] could not read sent Message-ID", { emailId: email.id, error });
    return email;
  }
}

/** `email.sent` / `email.delivered` webhook: remember the Message-ID replies will cite. */
export async function recordSentMessageId(
  resendEmailId: string | undefined,
  messageId: string | undefined,
): Promise<void> {
  const id = normalizeMessageId(messageId);
  if (!resendEmailId || !id) return;
  const email = await getEmailByResendId(resendEmailId);
  if (!email || email.direction !== "outbound" || email.messageId === id) return;
  await updateEmail(email.userId, email.id, { messageId: id });
}

export async function sendUserEmail(input: SendEmailInput): Promise<EmailRecord> {
  if (!resendConfigured()) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  }
  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc);
  if (to.length === 0) {
    throw new Error("At least one recipient is required.");
  }

  const owner = await findUserById(input.userId);
  const sender = chooseOutboundSender({
    appName: APP_NAME,
    ownerEmail: owner?.email,
    ownerName: owner?.name,
    recipients: [...to, ...cc],
    agentAddress: process.env.RESEND_FROM_EMAIL?.trim() || null,
  });
  const from = sender.from;

  const attachments = await documentAttachments(input.userId, input.documentIds);
  const parentMessageId = await resolveParentMessageId(input.userId, input.inReplyTo);
  const attachmentMeta: EmailAttachmentMeta[] = attachments.map((attachment) => ({
    filename: attachment.filename,
    contentType: attachment.contentType ?? "application/octet-stream",
    size: attachment.content.length,
  }));

  const email = await createEmail({
    userId: input.userId,
    direction: "outbound",
    fromAddress: from,
    toAddresses: to,
    ccAddresses: cc,
    subject: input.subject.trim(),
    bodyText: input.body,
    bodyHtml: input.html?.trim() || textToHtml(input.body),
    resendEmailId: null,
    status: "sent",
    hasActionItem: false,
    actionSummary: null,
    chatId: input.chatId ?? null,
    inReplyTo: parentMessageId,
    attachments: attachmentMeta,
  });

  const { data, error } = await getResend().emails.send(
    {
      from,
      to,
      ...(cc.length > 0 ? { cc } : {}),
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      subject: email.subject,
      text: email.bodyText,
      html: email.bodyHtml,
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
            })),
          }
        : {}),
      ...(parentMessageId
        ? {
            headers: {
              "In-Reply-To": messageIdHeader(parentMessageId),
              References: messageIdHeader(parentMessageId),
            },
          }
        : {}),
    },
    { idempotencyKey: input.idempotencyKey.slice(0, 256) },
  );

  if (error) {
    await updateEmail(input.userId, email.id, { status: "failed" });
    throw new Error(error.message);
  }

  const sent =
    (await updateEmail(input.userId, email.id, {
      resendEmailId: data?.id ?? null,
      status: "sent",
    })) ?? email;
  // Replies cite this Message-ID. Resend may not have it yet; the email.sent
  // webhook and the reply matcher fill it in later.
  const stored = await ensureSentMessageId(sent);
  void persistEmailEmbeddings(stored);
  return stored;
}
