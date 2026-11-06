import PostalMime from "postal-mime";
import { authenticationResultsInOrder } from "@/lib/email-auth";
import { parseAddressList } from "@/lib/email-users";
import { getResend } from "@/lib/resend";
import type { EmailAttachmentMeta } from "@/lib/types";

export class ReceivedEmailContentError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ReceivedEmailContentError";
  }
}

export type ReceivedEmailContent = {
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  receivedFor: string[];
  bodyHtml: string;
  bodyText: string;
  attachments: EmailAttachmentMeta[];
};

export function textToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div>${escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("")}</div>`;
}

export function htmlToText(html: string): string {
  if (!html.trim()) return "";
  let value = html.replace(/\r\n/g, "\n");
  value = value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  value = value.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  value = value.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ");
  value = value.replace(/\s(?:src|href)="data:[^"]*"/gi, "");
  value = value.replace(/<br\s*\/?>/gi, "\n");
  value = value.replace(/<\/(?:p|div|tr|h[1-6]|li|blockquote|pre|section|article|header|footer)>/gi, "\n");
  value = value.replace(/<[^>]+>/g, " ");
  value = decodeHtmlEntities(value);
  value = value.replace(/\u00a0/g, " ");
  value = value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  value = value.replace(/[ \t]{2,}/g, " ");
  return value.trim();
}

export function normalizeEmailBodies(input: {
  html?: string | null;
  text?: string | null;
}): { bodyHtml: string; bodyText: string } {
  const html = (input.html ?? "").trim();
  const text = (input.text ?? "").trim();
  const bodyText = text || htmlToText(html);
  const bodyHtml = html || (bodyText ? textToHtml(bodyText) : "");
  return { bodyHtml, bodyText };
}

export function emailHasCompleteBodies(email: { bodyText: string; bodyHtml: string }): boolean {
  return Boolean(email.bodyText.trim() && email.bodyHtml.trim());
}

export function emailBodyForEmbedding(email: { bodyText: string; bodyHtml: string }): string {
  return email.bodyText.trim() || htmlToText(email.bodyHtml);
}

export async function fetchReceivedEmailContent(resendEmailId: string): Promise<ReceivedEmailContent> {
  const { data, error } = await getResend().emails.receiving.get(resendEmailId, {
    html_format: "data_uri",
  });
  if (error || !data) {
    throw new ReceivedEmailContentError(
      error?.message || "Resend receiving.get returned no email body.",
      true,
    );
  }

  let html = data.html ?? "";
  let text = data.text ?? "";
  if (!html.trim() && !text.trim() && data.raw?.download_url) {
    const parsed = await parseRawEmail(data.raw.download_url);
    html = parsed.html;
    text = parsed.text;
  }

  const { bodyHtml, bodyText } = normalizeEmailBodies({ html, text });
  return {
    subject: (data.subject ?? "").trim(),
    from: data.from ?? "",
    to: parseAddressList(data.to),
    cc: parseAddressList(data.cc),
    receivedFor: parseAddressList(data.received_for),
    bodyHtml,
    bodyText,
    attachments: (data.attachments ?? []).map((attachment) => ({
      filename: attachment.filename || "attachment",
      contentType: attachment.content_type || "application/octet-stream",
      size: typeof attachment.size === "number" ? attachment.size : null,
    })),
  };
}

/**
 * `Authentication-Results` values of a received email, topmost first, read
 * from the raw message so duplicate headers keep their order (Resend's
 * `headers` map collapses them). Null when Resend has no raw message.
 */
export async function receivedAuthenticationResults(resendEmailId: string): Promise<string[] | null> {
  const { data } = await getResend().emails.receiving.get(resendEmailId);
  const url = data?.raw?.download_url;
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const parsed = await PostalMime.parse(await response.arrayBuffer());
  return authenticationResultsInOrder(parsed.headers ?? []);
}

async function parseRawEmail(downloadUrl: string): Promise<{ html: string; text: string }> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new ReceivedEmailContentError(`Raw email download failed (${response.status}).`, true);
  }
  const parsed = await PostalMime.parse(await response.arrayBuffer());
  return {
    html: parsed.html ?? "",
    text: parsed.text ?? "",
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, digits) => fromCodePoint(Number(digits)));
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "";
  return String.fromCodePoint(code);
}
