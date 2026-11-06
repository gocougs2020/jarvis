import type { SessionContext } from "eve/context";
import { appConfig } from "../../app.config";
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

type SessionIdentity = {
  readonly session: {
    readonly id: string;
    readonly parent?: { readonly rootSessionId: string } | null;
  };
};

/**
 * The session a chat is linked to. A delegated child (the built-in `agent`
 * tool or a declared subagent) inherits the root's auth, chat id included, but
 * runs in its own session; it must resolve to the root's chat, never re-link
 * the chat to itself, or reloading the chat would show the child's transcript.
 */
export function chatSessionId(ctx: SessionIdentity): string {
  return ctx.session.parent?.rootSessionId ?? ctx.session.id;
}

/** True inside a delegated child session rather than the user's own conversation. */
export function isChildSession(ctx: SessionIdentity): boolean {
  return Boolean(ctx.session.parent);
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

function isAccountAddress(value: string, accountEmail: unknown): boolean {
  return (
    typeof accountEmail === "string" &&
    accountEmail.trim().length > 0 &&
    value.trim().toLowerCase() === accountEmail.trim().toLowerCase()
  );
}

/**
 * Mail that goes only to the signed-in user (omitted `to`, a "me" alias, or
 * their own account address, and no `cc`) is sent without approval, from any
 * session, unless `security.selfEmailRequiresApproval` is on. It cannot reach
 * anyone else, so text injected into a web page, file, or forwarded email
 * gains nothing by triggering it, and a research run, schedule, or emailed
 * request no longer stalls on an approval nobody is watching.
 *
 * Anyone else always needs a person to approve.
 */
export function sendEmailNeedsApproval(
  attributes: Readonly<Record<string, unknown>> | null | undefined,
  toolInput: unknown,
  options: { selfEmailRequiresApproval?: boolean } = {},
): boolean {
  const reminder = attributes?.source === "schedule" && attributes?.reminder === "1";
  const selfRequiresApproval =
    options.selfEmailRequiresApproval ?? appConfig.security.selfEmailRequiresApproval;
  if (selfRequiresApproval && !reminder) return true;
  const input = (toolInput ?? {}) as { to?: unknown; cc?: unknown };
  if (input.to !== undefined && typeof input.to !== "string") return true;
  const to = typeof input.to === "string" ? input.to : undefined;
  const toSelf = isSelfSendTarget(to) || isAccountAddress(to ?? "", attributes?.email);
  if (!toSelf) return true;
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
