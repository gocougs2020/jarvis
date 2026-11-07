import { ensureNeonAuthSchema } from "@/lib/db";
import {
  findUserByEmail,
  fromMatchesAccount,
  normalizeEmailAddress,
  oldestUser,
  type AppUser,
} from "@/lib/email-users";

/**
 * Jarvis is one person's agent: exactly one account, the owner.
 *
 * - `OWNER_EMAIL` set: only that address can create the account, sign in,
 *   or keep a session. Any other account in the database (from an older,
 *   multi-user version) is locked out; its rows stay untouched.
 * - Anywhere else without `OWNER_EMAIL` (Vercel, `next start`, Docker, any
 *   host): nobody can create an account, and the home page shows the setup
 *   checklist. A public deploy can't be claimed by whoever finds it first.
 * - Only under `next dev` (`NODE_ENV=development`, off Vercel) without it:
 *   the first sign-up becomes the owner and sign-up closes behind it.
 */

export const SIGNUP_NOT_ALLOWED_MESSAGE = "Only the owner's email can create an account on this app.";
export const SIGNUP_CLOSED_MESSAGE = "This app already has its owner account. Sign in instead.";
export const OWNER_NOT_CONFIGURED_MESSAGE =
  "Set OWNER_EMAIL on this deployment to your email, redeploy, then create your account.";
export const ACCESS_DENIED_MESSAGE = "This account can't sign in to this app.";

/** `OWNER_EMAIL`, normalized, or null when unset. */
export function configuredOwnerEmail(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const value = env.OWNER_EMAIL?.trim();
  return value ? normalizeEmailAddress(value) : null;
}

/**
 * The owner must be named up front everywhere except a local `next dev`
 * process. Fails closed: production builds on any host, tests, and Vercel
 * (including `vercel dev`) all require OWNER_EMAIL.
 */
export function ownerEmailRequired(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.VERCEL) || env.NODE_ENV !== "development";
}

export type SignupDecision = { ok: true } | { ok: false; message: string };

/** Pure rule for creating an account. `accountExists`: any user row exists already. */
export function signupDecision(
  email: string,
  { ownerEmail, ownerRequired, accountExists }: { ownerEmail: string | null; ownerRequired: boolean; accountExists: boolean },
): SignupDecision {
  if (ownerEmail) {
    return normalizeEmailAddress(email) === ownerEmail
      ? { ok: true }
      : { ok: false, message: SIGNUP_NOT_ALLOWED_MESSAGE };
  }
  if (ownerRequired) return { ok: false, message: OWNER_NOT_CONFIGURED_MESSAGE };
  return accountExists ? { ok: false, message: SIGNUP_CLOSED_MESSAGE } : { ok: true };
}

/** Pure rule for signing in or keeping a session. `oldestEmail`: email of the first account, if any. */
export function isOwnerEmailFor(
  email: string,
  { ownerEmail, ownerRequired, oldestEmail }: { ownerEmail: string | null; ownerRequired: boolean; oldestEmail: string | null },
): boolean {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return false;
  if (ownerEmail) return normalized === ownerEmail;
  if (ownerRequired) return false;
  return Boolean(oldestEmail) && normalized === normalizeEmailAddress(oldestEmail!);
}

// Without OWNER_EMAIL, the owner is the oldest account. It never changes once
// it exists (sign-up closes behind it), so it is cached for the process.
let cachedOldest: AppUser | null = null;

async function oldestAccount(): Promise<AppUser | null> {
  if (cachedOldest) return cachedOldest;
  await ensureNeonAuthSchema();
  cachedOldest = await oldestUser();
  return cachedOldest;
}

/** For tests. */
export function resetOwnerCache() {
  cachedOldest = null;
}

export async function canCreateAccount(email: string): Promise<SignupDecision> {
  const ownerEmail = configuredOwnerEmail();
  const ownerRequired = ownerEmailRequired();
  const accountExists = ownerEmail || ownerRequired ? false : Boolean(await oldestAccount());
  return signupDecision(email, { ownerEmail, ownerRequired, accountExists });
}

export async function isOwnerEmail(email: string): Promise<boolean> {
  const ownerEmail = configuredOwnerEmail();
  const ownerRequired = ownerEmailRequired();
  const oldestEmail = ownerEmail || ownerRequired ? null : ((await oldestAccount())?.email ?? null);
  return isOwnerEmailFor(email, { ownerEmail, ownerRequired, oldestEmail });
}

/** The owner's account, or null before it has been created (or when OWNER_EMAIL is missing on Vercel). */
export async function ownerAccount(): Promise<AppUser | null> {
  const ownerEmail = configuredOwnerEmail();
  if (ownerEmail) {
    await ensureNeonAuthSchema();
    return findUserByEmail(ownerEmail);
  }
  if (ownerEmailRequired()) return null;
  return oldestAccount();
}

/**
 * Mail to the agent address always belongs to the owner. `fromAccount` is
 * true only when From is the owner's own address; From is spoofable, so
 * callers still check sender authentication (DMARC) before acting on it.
 */
export async function inboundMailOwner(
  fromAddress: string | null | undefined,
): Promise<{ user: AppUser; fromAccount: boolean } | null> {
  const owner = await ownerAccount();
  if (!owner) return null;
  return { user: owner, fromAccount: fromMatchesAccount(fromAddress, owner.email) };
}
