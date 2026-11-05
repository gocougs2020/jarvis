import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared secret for server-to-self calls (scheduled runs and inbound-email
 * sessions). `EMAIL_SESSION_SECRET` wins when set. Otherwise it is derived
 * from `BETTER_AUTH_SECRET`, so a deploy needs no extra variable and the raw
 * auth secret never travels in a header. It is never the Resend webhook
 * secret, which anyone with Resend dashboard access can read.
 */
export function internalDispatchSecret(): string | null {
  const explicit = process.env.EMAIL_SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!authSecret) return null;
  return createHmac("sha256", authSecret).update("jarvis:internal-dispatch:v1").digest("hex");
}

/** Constant-time comparison for a presented secret header. */
export function secretsMatch(presented: string | null | undefined, expected: string | null): boolean {
  if (!presented || !expected) return false;
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function isInternalDispatchRequest(presented: string | null | undefined): boolean {
  return secretsMatch(presented, internalDispatchSecret());
}

function httpsOrigin(host: string | undefined): string | null {
  const trimmed = host?.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Public origin for links in email and for server-to-self calls. Built only
 * from configuration, never from the request's Host header, so a spoofed Host
 * cannot redirect a server-side call (and its secret) somewhere else.
 */
export function appOrigin(): string {
  return (
    httpsOrigin(process.env.BETTER_AUTH_URL) ||
    httpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    httpsOrigin(process.env.VERCEL_URL) ||
    "http://localhost:3000"
  );
}

/** This deployment's own origin (a preview calls itself, not production). */
export function selfOrigin(): string {
  return httpsOrigin(process.env.VERCEL_URL) || appOrigin();
}

const EVE_SESSION_PATH = /\/eve\/v1\/session\/([^/?#]+)/;

/** The session id in an eve continuation, stream, or control URL. */
export function eveSessionIdFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
  const match = pathname.match(EVE_SESSION_PATH);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * True when a browser says this request came from another site. Used on
 * cookie-setting form posts (sign-in, sign-up) and the local setup writer,
 * which SameSite cookies alone do not protect. Requests with neither
 * `Sec-Fetch-Site` nor `Origin` (curl, server calls) are not browser CSRF.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return true;
  }
  return origin !== requestOrigin && origin !== appOrigin();
}
