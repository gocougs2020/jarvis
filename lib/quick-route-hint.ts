import { createHmac } from "node:crypto";
import { secretsMatch } from "./internal-auth";
import { isQuickRoute, type QuickRoute } from "./quick-route";

const HINT_TTL_MS = 5 * 60_000;

function hintKey(): string | null {
  const secret =
    process.env.BETTER_AUTH_SECRET?.trim() || process.env.EMAIL_SESSION_SECRET?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update("jarvis:quick-route:v1").digest("hex");
}

function signature(key: string, userId: string, route: QuickRoute, expires: number): string {
  return createHmac("sha256", key).update(`${userId}\n${route}\n${expires}`).digest("base64url");
}

/**
 * The quick-reply layer already classified the prompt, so the agent can skip
 * its own routing call. The hint is signed for one user and expires quickly,
 * so a client cannot pick a model for a session it did not just hand off.
 */
export function signQuickRouteHint(
  userId: string,
  route: QuickRoute,
  now = Date.now(),
): string | null {
  const key = hintKey();
  if (!key) return null;
  const expires = now + HINT_TTL_MS;
  return `${route}.${expires}.${signature(key, userId, route, expires)}`;
}

export function verifyQuickRouteHint(
  hint: string | null | undefined,
  userId: string,
  now = Date.now(),
): QuickRoute | null {
  const key = hintKey();
  if (!key || !hint) return null;
  const [route, expiresText, presented, ...rest] = hint.trim().split(".");
  if (rest.length > 0 || !isQuickRoute(route) || !expiresText || !presented) return null;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + HINT_TTL_MS) return null;
  return secretsMatch(presented, signature(key, userId, route, expires)) ? route : null;
}
