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

/** The first account created, or null. `lib/owner.ts` decides who the owner is. */
export async function oldestUser(): Promise<AppUser | null> {
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

/** Account lookup by (normalized) email. Emails are stored lowercase by better-auth. */
export async function findUserByEmail(email: string): Promise<AppUser | null> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return null;
  if (hasNeon()) {
    const [row] = await getNeonDb()
      .select({ id: pgUser.id, email: pgUser.email, name: pgUser.name })
      .from(pgUser)
      .where(eq(pgUser.email, normalized))
      .limit(1);
    return row ?? null;
  }
  const rows = await getSqliteDb()
    .select({ id: sqliteUser.id, email: sqliteUser.email, name: sqliteUser.name })
    .from(sqliteUser)
    .where(eq(sqliteUser.email, normalized))
    .limit(1);
  return rows[0] ?? null;
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

