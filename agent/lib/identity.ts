import type { SessionContext } from "eve/context";
import { findUserById } from "../../lib/email-users";

const SELF_RECIPIENTS = new Set([
  "me",
  "myself",
  "self",
  "my email",
  "my email address",
  "my address",
]);

type SessionAuth = {
  principalId?: string | null;
  principalType?: string | null;
  attributes?: Record<string, unknown> | null;
  authenticator?: string;
  issuer?: string | null;
};

export function userFromAuth(auth: SessionAuth | null | undefined) {
  if (auth?.principalType !== "user" || !auth.principalId) return null;
  return {
    userId: auth.principalId,
    email: typeof auth.attributes?.email === "string" ? auth.attributes.email : null,
    name: typeof auth.attributes?.name === "string" ? auth.attributes.name : null,
    authenticator: auth.authenticator,
    issuer: auth.issuer ?? null,
    chatId: typeof auth.attributes?.chatId === "string" ? auth.attributes.chatId : null,
  };
}

export function optionalUser(ctx: SessionContext) {
  return userFromAuth(ctx.session.auth.current);
}

export function requireUser(ctx: SessionContext) {
  const user = optionalUser(ctx);
  if (!user) {
    throw new Error("An authenticated user is required.");
  }
  return user;
}

export async function accountEmail(user: {
  userId: string;
  email: string | null;
}): Promise<string | null> {
  const fromAuth = user.email?.trim();
  if (fromAuth) return fromAuth;
  const row = await findUserById(user.userId);
  return row?.email.trim() || null;
}

export function isSelfSendTarget(to?: string | null): boolean {
  const trimmed = to?.trim() ?? "";
  return !trimmed || SELF_RECIPIENTS.has(trimmed.toLowerCase());
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

/**
 * Unattended reminder runs may email the signed-in user without approval, and
 * nobody else. Any `cc`, or a named `to`, needs a person to approve — otherwise
 * text injected into a shared file or a forwarded email could add an outside
 * recipient to a reminder that nobody reviews.
 */
export function sendEmailNeedsApproval(
  attributes: Readonly<Record<string, unknown>> | null | undefined,
  toolInput: unknown,
): boolean {
  const reminder = attributes?.source === "schedule" && attributes?.reminder === "1";
  if (!reminder) return true;
  const input = (toolInput ?? {}) as { to?: unknown; cc?: unknown };
  const to = typeof input.to === "string" ? input.to : undefined;
  if (input.to !== undefined && typeof input.to !== "string") return true;
  if (!isSelfSendTarget(to)) return true;
  return hasValue(input.cc);
}

/** Omit `to`, or pass "me" / "my email", to send to the signed-in account. */
export async function resolveSendTo(
  user: { userId: string; email: string | null },
  to: string | undefined,
): Promise<string | null> {
  if (isSelfSendTarget(to)) {
    return accountEmail(user);
  }
  return to?.trim() || null;
}
