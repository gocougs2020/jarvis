import { asc, eq } from "drizzle-orm";
import { getNeonDb, getSqliteDb, hasNeon } from "@/lib/db";
import { pgUser, sqliteUser } from "@/lib/db/schema";

export type AppUser = {
  id: string;
  email: string;
  name: string;
};

export function normalizeEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

/** Split a `to`/`cc` field (`string` or `string[]`, including comma-separated values) into addresses. */
export function parseAddressList(
  value: string | readonly string[] | undefined | null,
): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? [...value] : [value])
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => normalizeEmailAddress(entry))
    .filter((entry) => entry.includes("@"));
}

export async function listAppUsers(): Promise<AppUser[]> {
  if (hasNeon()) {
    return getNeonDb()
      .select({ id: pgUser.id, email: pgUser.email, name: pgUser.name })
      .from(pgUser);
  }
  return getSqliteDb()
    .select({ id: sqliteUser.id, email: sqliteUser.email, name: sqliteUser.name })
    .from(sqliteUser);
}

/** The workspace owner: the first account created. This app is one person's agent. */
async function primaryAppUser(): Promise<AppUser | null> {
  if (hasNeon()) {
    const [row] = await getNeonDb()
      .select({ id: pgUser.id, email: pgUser.email, name: pgUser.name })
      .from(pgUser)
      .orderBy(asc(pgUser.createdAt))
      .limit(1);
    return row ?? null;
  }
  const rows = await getSqliteDb()
    .select({ id: sqliteUser.id, email: sqliteUser.email, name: sqliteUser.name })
    .from(sqliteUser)
    .orderBy(asc(sqliteUser.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Who mail to the agent address belongs to: the account whose email sent
 * it, or else the workspace owner. `fromAccount` is true only in the first
 * case; From is spoofable, so callers still check sender authentication
 * before acting on it.
 */
export async function inboundMailOwner(
  fromAddress: string | null | undefined,
): Promise<{ user: AppUser; fromAccount: boolean } | null> {
  const from = fromAddress ? normalizeEmailAddress(fromAddress) : "";
  if (from) {
    const sender = (await listAppUsers()).find((user) => normalizeEmailAddress(user.email) === from);
    if (sender) return { user: sender, fromAccount: true };
  }
  const owner = await primaryAppUser();
  return owner ? { user: owner, fromAccount: false } : null;
}

export async function findUserById(userId: string): Promise<AppUser | null> {
  if (!userId) return null;
  if (hasNeon()) {
    const [row] = await getNeonDb()
      .select({ id: pgUser.id, email: pgUser.email, name: pgUser.name })
      .from(pgUser)
      .where(eq(pgUser.id, userId))
      .limit(1);
    return row ?? null;
  }
  const rows = await getSqliteDb()
    .select({ id: sqliteUser.id, email: sqliteUser.email, name: sqliteUser.name })
    .from(sqliteUser)
    .where(eq(sqliteUser.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export function fromMatchesAccount(
  fromAddress: string | null | undefined,
  ownerEmail: string | null | undefined,
): boolean {
  const from = fromAddress ? normalizeEmailAddress(fromAddress) : "";
  const owner = ownerEmail ? normalizeEmailAddress(ownerEmail) : "";
  return Boolean(from && owner && from === owner);
}

