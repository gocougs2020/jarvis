import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getNeonDb } from "@/lib/db";
import {
  pgChatEvents,
  pgChats,
  pgDocumentFolders,
  pgDocuments,
  pgDocumentSessions,
  pgEmails,
  pgEmbeddings,
  pgScheduledJobs,
  pgSessionCitations,
  pgUsageEvents,
  pgUserSettings,
  pgUserSkills,
} from "@/lib/db/schema";
import type {
  ChatEventRecord,
  ChatPatch,
  ChatRecord,
  ChatSource,
  DocumentFolder,
  DocumentKind,
  DocumentRecord,
  EmailDirection,
  EmailRecord,
  EmbeddingKind,
  EmbeddingRecord,
  EmbeddingSourceType,
  SessionCitationSet,
  ScheduledJob,
  UsageRecord,
  UserSettings,
  UserSkill,
} from "@/lib/types";
import { parseJobCadence } from "@/lib/job-cadence";
import {
  applyCitationUpdate,
  applyEmbeddingUpdate,
  applySettingsPatch,
  asDate,
  chatEventId,
  chatEventRecords,
  chatPatchFields,
  completeJobMutation,
  type CreateEmailInput,
  type CreateEmbeddingInput,
  type CreateJobInput,
  type CreateSkillInput,
  type EmailPatch,
  type JobPatch,
  type UpsertCitationInput,
  defaultSettings,
  EMAIL_LIST_DEFAULT_LIMIT,
  settingsFromStored,
  jobCadenceUpdate,
  newChatRecord,
  newCitationSet,
  newEmailRecord,
  newEmbeddingRecord,
  newJobRecord,
  newSkillRecord,
  normalizeChat,
  normalizeEmail,
  nowIso,
  releasedJobFields,
  toIso,
} from "@/lib/store-logic";
import {
  LIBRARY_SHARE_VALUES,
  isVisibleToViewer,
  normalizeLibraryVisibility,
  normalizeVisibility,
} from "@/lib/visibility";

export { searchUserEmbeddings } from "@/lib/store-pg-embeddings";

function nowDate() {
  return new Date();
}

function mapChat(row: typeof pgChats.$inferSelect): ChatRecord {
  return normalizeChat({
    id: row.id,
    userId: row.userId,
    title: row.title,
    description: row.description ?? "",
    source: row.source as ChatSource,
    sessionId: row.sessionId,
    streamIndex: row.streamIndex,
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  });
}

function mapSkill(row: typeof pgUserSkills.$inferSelect): UserSkill {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name ?? "",
    slug: row.slug,
    description: row.description,
    markdown: row.markdown,
    enabled: row.enabled,
    visibility: normalizeVisibility(row.visibility),
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function mapDocument(row: typeof pgDocuments.$inferSelect): DocumentRecord {
  return {
    id: row.id,
    userId: row.userId,
    folderId: row.folderId ?? null,
    title: row.title,
    filename: row.filename,
    kind: row.kind as DocumentKind,
    mimeType: row.mimeType,
    blobPathname: row.blobPathname,
    blobUrl: row.blobUrl,
    size: row.size,
    isPublic: row.isPublic || row.visibility === "public",
    shareId: row.shareId,
    visibility: normalizeLibraryVisibility(row.visibility, row.isPublic),
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function mapFolder(row: typeof pgDocumentFolders.$inferSelect): DocumentFolder {
  return {
    id: row.id,
    userId: row.userId,
    parentId: row.parentId ?? null,
    name: row.name,
    description: row.description,
    visibility: normalizeLibraryVisibility(row.visibility),
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

function mapJob(row: typeof pgScheduledJobs.$inferSelect): ScheduledJob {
  return {
    id: row.id,
    userId: row.userId,
    prompt: row.prompt,
    firstRunAt: toIso(row.firstRunAt) ?? "",
    nextRunAt: toIso(row.nextRunAt) ?? "",
    everyMinutes: row.everyMinutes,
    cadence: parseJobCadence(row.cadence),
    enabled: row.enabled,
    leaseToken: row.leaseToken,
    leaseUntil: toIso(row.leaseUntil),
    lastError: row.lastError,
    authenticator: row.authenticator,
    issuer: row.issuer,
    visibility: normalizeVisibility(row.visibility),
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const [row] = await getNeonDb()
    .select()
    .from(pgUserSettings)
    .where(eq(pgUserSettings.userId, userId))
    .limit(1);
  if (!row) return defaultSettings(userId);
  return settingsFromStored(row);
}

export async function upsertUserSettings(
  userId: string,
  patch: Partial<Pick<UserSettings, "modelTier" | "instructionOverlay">>,
): Promise<UserSettings> {
  const current = await getUserSettings(userId);
  const next = applySettingsPatch(current, patch);
  await getNeonDb()
    .insert(pgUserSettings)
    .values({
      userId,
      modelTier: next.modelTier,
      instructionOverlay: next.instructionOverlay,
    })
    .onConflictDoUpdate({
      target: pgUserSettings.userId,
      set: {
        modelTier: next.modelTier,
        instructionOverlay: next.instructionOverlay,
      },
    });
  return next;
}

export async function listChats(userId: string): Promise<ChatRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgChats)
    .where(eq(pgChats.userId, userId))
    .orderBy(desc(pgChats.updatedAt));
  return rows.map(mapChat);
}

export async function listAccountChats(): Promise<ChatRecord[]> {
  const rows = await getNeonDb().select().from(pgChats).orderBy(desc(pgChats.updatedAt));
  return rows.map(mapChat);
}

export async function getChat(userId: string, chatId: string): Promise<ChatRecord | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgChats)
    .where(and(eq(pgChats.userId, userId), eq(pgChats.id, chatId)))
    .limit(1);
  return row ? mapChat(row) : null;
}

export async function createChat(
  userId: string,
  title: string,
  source: ChatSource = "web",
): Promise<ChatRecord> {
  const chat = newChatRecord(userId, title, source);
  await getNeonDb().insert(pgChats).values({
    ...chat,
    createdAt: asDate(chat.createdAt),
    updatedAt: asDate(chat.updatedAt),
  });
  return chat;
}

export async function updateChat(
  userId: string,
  chatId: string,
  patch: ChatPatch,
): Promise<ChatRecord | null> {
  const current = await getChat(userId, chatId);
  if (!current) return null;
  const [row] = await getNeonDb()
    .update(pgChats)
    .set({
      ...chatPatchFields(patch),
      ...(patch.touchUpdatedAt ? { updatedAt: nowDate() } : {}),
    })
    .where(and(eq(pgChats.userId, userId), eq(pgChats.id, chatId)))
    .returning();
  return row ? mapChat(row) : null;
}

export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const deleted = await getNeonDb()
    .delete(pgChats)
    .where(and(eq(pgChats.userId, userId), eq(pgChats.id, chatId)))
    .returning({ id: pgChats.id });
  if (deleted.length === 0) return false;
  await getNeonDb().delete(pgChatEvents).where(eq(pgChatEvents.chatId, chatId));
  await getNeonDb().delete(pgDocumentSessions).where(eq(pgDocumentSessions.chatId, chatId));
  await getNeonDb()
    .delete(pgEmbeddings)
    .where(
      and(
        eq(pgEmbeddings.userId, userId),
        eq(pgEmbeddings.sourceType, "session"),
        eq(pgEmbeddings.sourceId, chatId),
      ),
    );
  await getNeonDb()
    .delete(pgSessionCitations)
    .where(and(eq(pgSessionCitations.userId, userId), eq(pgSessionCitations.chatId, chatId)));
  return true;
}

export async function getChatByEveSessionId(
  userId: string,
  eveSessionId: string,
): Promise<ChatRecord | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgChats)
    .where(and(eq(pgChats.userId, userId), eq(pgChats.sessionId, eveSessionId)))
    .limit(1);
  return row ? mapChat(row) : null;
}

/** Every user whose chat records this eve session id (normally zero or one). */
export async function listChatOwnersForEveSession(eveSessionId: string): Promise<string[]> {
  const rows = await getNeonDb()
    .select({ userId: pgChats.userId })
    .from(pgChats)
    .where(eq(pgChats.sessionId, eveSessionId))
    .limit(10);
  return [...new Set(rows.map((row) => row.userId))];
}

export async function listChatEvents(chatId: string): Promise<ChatEventRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgChatEvents)
    .where(eq(pgChatEvents.chatId, chatId))
    .orderBy(pgChatEvents.index);
  return rows.map((row) => ({
    id: row.id,
    chatId: row.chatId,
    index: row.index,
    event: row.event,
  }));
}

export async function upsertChatEvent(chatId: string, index: number, event: unknown) {
  const id = chatEventId(chatId, index);
  await getNeonDb()
    .insert(pgChatEvents)
    .values({ id, chatId, index, event })
    .onConflictDoUpdate({
      target: pgChatEvents.id,
      set: { event },
    });
}

export async function replaceChatEvents(chatId: string, events: unknown[]) {
  const db = getNeonDb();
  if (events.length === 0) {
    await db.delete(pgChatEvents).where(eq(pgChatEvents.chatId, chatId));
    return;
  }
  // Upsert first so overlapping persists from the same streaming session
  // cannot collide on the deterministic `${chatId}:${index}` primary key.
  await db
    .insert(pgChatEvents)
    .values(chatEventRecords(chatId, events))
    .onConflictDoUpdate({
      target: pgChatEvents.id,
      set: { event: sql`excluded.event` },
    });
  await db
    .delete(pgChatEvents)
    .where(and(eq(pgChatEvents.chatId, chatId), gte(pgChatEvents.index, events.length)));
}

/**
 * Checkpoint: rows before `fromIndex` are unchanged, so write only
 * `events` at `fromIndex..`, then drop rows at or past `total`.
 */
export async function writeChatEventsTail(
  chatId: string,
  fromIndex: number,
  events: unknown[],
  total: number,
) {
  const db = getNeonDb();
  if (events.length > 0) {
    await db
      .insert(pgChatEvents)
      .values(chatEventRecords(chatId, events, fromIndex))
      .onConflictDoUpdate({
        target: pgChatEvents.id,
        set: { event: sql`excluded.event` },
      });
  }
  await db
    .delete(pgChatEvents)
    .where(and(eq(pgChatEvents.chatId, chatId), gte(pgChatEvents.index, total)));
}

export async function listUserSkills(userId: string): Promise<UserSkill[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgUserSkills)
    .where(eq(pgUserSkills.userId, userId));
  return rows.map(mapSkill);
}

export async function createUserSkill(
  userId: string,
  input: CreateSkillInput,
): Promise<UserSkill> {
  const skill = newSkillRecord(userId, input);
  await getNeonDb().insert(pgUserSkills).values({
    ...skill,
    createdAt: asDate(skill.createdAt),
    updatedAt: asDate(skill.updatedAt),
  });
  return skill;
}

export async function updateUserSkill(
  userId: string,
  skillId: string,
  patch: Partial<Pick<UserSkill, "name" | "slug" | "description" | "markdown" | "enabled" | "visibility">>,
): Promise<UserSkill | null> {
  const [row] = await getNeonDb()
    .update(pgUserSkills)
    .set({ ...patch, updatedAt: nowDate() })
    .where(and(eq(pgUserSkills.userId, userId), eq(pgUserSkills.id, skillId)))
    .returning();
  return row ? mapSkill(row) : null;
}

export async function deleteUserSkill(userId: string, skillId: string): Promise<boolean> {
  const deleted = await getNeonDb()
    .delete(pgUserSkills)
    .where(and(eq(pgUserSkills.userId, userId), eq(pgUserSkills.id, skillId)))
    .returning({ id: pgUserSkills.id });
  return deleted.length > 0;
}

export async function listJobs(userId: string): Promise<ScheduledJob[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgScheduledJobs)
    .where(eq(pgScheduledJobs.userId, userId))
    .orderBy(pgScheduledJobs.nextRunAt);
  return rows.map(mapJob);
}

export async function createJob(
  userId: string,
  input: CreateJobInput,
): Promise<ScheduledJob> {
  const job = newJobRecord(userId, input);
  await getNeonDb().insert(pgScheduledJobs).values({
    ...job,
    firstRunAt: asDate(job.firstRunAt),
    nextRunAt: asDate(job.nextRunAt),
    leaseUntil: job.leaseUntil ? asDate(job.leaseUntil) : null,
    createdAt: asDate(job.createdAt),
    updatedAt: asDate(job.updatedAt),
  });
  return job;
}

export async function updateJob(
  userId: string,
  jobId: string,
  patch: JobPatch,
): Promise<ScheduledJob | null> {
  const { nextRunAt, ...rest } = patch;
  const cadence = jobCadenceUpdate(patch);
  const next = {
    ...rest,
    ...(nextRunAt ? { nextRunAt: asDate(nextRunAt) } : {}),
    ...(cadence !== undefined ? { cadence } : {}),
    updatedAt: nowDate(),
  };
  const [row] = await getNeonDb()
    .update(pgScheduledJobs)
    .set(next)
    .where(and(eq(pgScheduledJobs.userId, userId), eq(pgScheduledJobs.id, jobId)))
    .returning();
  return row ? mapJob(row) : null;
}

export async function deleteJob(userId: string, jobId: string): Promise<boolean> {
  const deleted = await getNeonDb()
    .delete(pgScheduledJobs)
    .where(and(eq(pgScheduledJobs.userId, userId), eq(pgScheduledJobs.id, jobId)))
    .returning({ id: pgScheduledJobs.id });
  return deleted.length > 0;
}

function jobUnleased(now: Date) {
  return or(isNull(pgScheduledJobs.leaseUntil), lte(pgScheduledJobs.leaseUntil, now));
}

function jobOwnedByLease(job: ScheduledJob) {
  return and(eq(pgScheduledJobs.id, job.id), eq(pgScheduledJobs.leaseToken, job.leaseToken ?? ""));
}

export async function claimDueJobs(options: {
  now: Date;
  limit: number;
  leaseForMs: number;
}): Promise<ScheduledJob[]> {
  const due = await getNeonDb()
    .select({ id: pgScheduledJobs.id })
    .from(pgScheduledJobs)
    .where(
      and(
        eq(pgScheduledJobs.enabled, true),
        lte(pgScheduledJobs.nextRunAt, options.now),
        jobUnleased(options.now),
      ),
    )
    .orderBy(pgScheduledJobs.nextRunAt)
    .limit(options.limit);

  const leaseUntil = new Date(options.now.getTime() + options.leaseForMs);
  const claimed: ScheduledJob[] = [];
  for (const job of due) {
    const token = randomUUID();
    const [row] = await getNeonDb()
      .update(pgScheduledJobs)
      .set({
        leaseToken: token,
        leaseUntil,
        updatedAt: nowDate(),
      })
      .where(
        and(
          eq(pgScheduledJobs.id, job.id),
          eq(pgScheduledJobs.enabled, true),
          lte(pgScheduledJobs.nextRunAt, options.now),
          jobUnleased(options.now),
        ),
      )
      .returning();
    if (row) claimed.push(mapJob(row));
  }
  return claimed;
}

export async function claimJob(
  jobId: string,
  options: { now: Date; leaseForMs: number },
): Promise<ScheduledJob | null> {
  const [row] = await getNeonDb()
    .update(pgScheduledJobs)
    .set({
      leaseToken: randomUUID(),
      leaseUntil: new Date(options.now.getTime() + options.leaseForMs),
      updatedAt: nowDate(),
    })
    .where(
      and(eq(pgScheduledJobs.id, jobId), eq(pgScheduledJobs.enabled, true), jobUnleased(options.now)),
    )
    .returning();
  return row ? mapJob(row) : null;
}

export async function completeJob(job: ScheduledJob): Promise<boolean> {
  if (!job.leaseToken) return false;
  const mutation = completeJobMutation(job);
  if (mutation.action === "delete") {
    const deleted = await getNeonDb()
      .delete(pgScheduledJobs)
      .where(jobOwnedByLease(job))
      .returning({ id: pgScheduledJobs.id });
    return deleted.length > 0;
  }
  const updated = await getNeonDb()
    .update(pgScheduledJobs)
    .set({
      enabled: mutation.enabled,
      ...(mutation.nextRunAt ? { nextRunAt: asDate(mutation.nextRunAt) } : {}),
      leaseToken: mutation.leaseToken,
      leaseUntil: mutation.leaseUntil,
      lastError: mutation.lastError,
      updatedAt: nowDate(),
    })
    .where(jobOwnedByLease(job))
    .returning({ id: pgScheduledJobs.id });
  return updated.length > 0;
}

export async function releaseJob(
  job: ScheduledJob,
  error: string,
  retryAt?: Date | null,
  disable = false,
): Promise<boolean> {
  if (!job.leaseToken) return false;
  const fields = releasedJobFields(error, retryAt?.toISOString() ?? null, nowIso(), disable);
  const updated = await getNeonDb()
    .update(pgScheduledJobs)
    .set({
      leaseToken: fields.leaseToken,
      leaseUntil: fields.leaseUntil,
      lastError: fields.lastError,
      ...(retryAt ? { nextRunAt: retryAt } : {}),
      ...(disable ? { enabled: false } : {}),
      updatedAt: asDate(fields.updatedAt),
    })
    .where(jobOwnedByLease(job))
    .returning({ id: pgScheduledJobs.id });
  return updated.length > 0;
}

export async function listDocuments(userId: string): Promise<DocumentRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgDocuments)
    .where(or(eq(pgDocuments.userId, userId), inArray(pgDocuments.visibility, LIBRARY_SHARE_VALUES)))
    .orderBy(desc(pgDocuments.updatedAt));
  return rows.map(mapDocument);
}

export async function listFolders(userId: string): Promise<DocumentFolder[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgDocumentFolders)
    .where(
      or(eq(pgDocumentFolders.userId, userId), inArray(pgDocumentFolders.visibility, LIBRARY_SHARE_VALUES)),
    )
    .orderBy(pgDocumentFolders.name);
  return rows.map(mapFolder);
}

export async function getFolder(userId: string, folderId: string): Promise<DocumentFolder | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgDocumentFolders)
    .where(eq(pgDocumentFolders.id, folderId))
    .limit(1);
  if (!row) return null;
  const folder = mapFolder(row);
  return isVisibleToViewer(folder, userId) ? folder : null;
}

export async function createFolder(record: DocumentFolder): Promise<DocumentFolder> {
  await getNeonDb().insert(pgDocumentFolders).values({
    id: record.id,
    userId: record.userId,
    parentId: record.parentId,
    name: record.name,
    description: record.description,
    visibility: record.visibility,
    createdAt: asDate(record.createdAt),
    updatedAt: asDate(record.updatedAt),
  });
  return record;
}

export async function updateFolder(
  userId: string,
  folderId: string,
  patch: Partial<Pick<DocumentFolder, "name" | "description" | "parentId" | "visibility">>,
): Promise<DocumentFolder | null> {
  const [row] = await getNeonDb()
    .update(pgDocumentFolders)
    .set({ ...patch, updatedAt: nowDate() })
    .where(and(eq(pgDocumentFolders.userId, userId), eq(pgDocumentFolders.id, folderId)))
    .returning();
  return row ? mapFolder(row) : null;
}

export async function deleteFolder(
  userId: string,
  folderId: string,
): Promise<DocumentFolder | null> {
  const current = await getFolder(userId, folderId);
  if (!current || current.userId !== userId) return null;
  const parentId = current.parentId;
  await getNeonDb()
    .update(pgDocumentFolders)
    .set({ parentId, updatedAt: nowDate() })
    .where(eq(pgDocumentFolders.parentId, folderId));
  await getNeonDb()
    .update(pgDocuments)
    .set({ folderId: parentId, updatedAt: nowDate() })
    .where(eq(pgDocuments.folderId, folderId));
  await getNeonDb()
    .delete(pgDocumentFolders)
    .where(and(eq(pgDocumentFolders.userId, userId), eq(pgDocumentFolders.id, folderId)));
  return current;
}

export async function getDocument(userId: string, documentId: string): Promise<DocumentRecord | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgDocuments)
    .where(eq(pgDocuments.id, documentId))
    .limit(1);
  if (!row) return null;
  const document = mapDocument(row);
  return isVisibleToViewer(document, userId) ? document : null;
}

export async function getPublicDocument(shareId: string): Promise<DocumentRecord | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgDocuments)
    .where(and(eq(pgDocuments.shareId, shareId), eq(pgDocuments.isPublic, true)))
    .limit(1);
  return row ? mapDocument(row) : null;
}

export async function createDocument(record: DocumentRecord): Promise<DocumentRecord> {
  await getNeonDb().insert(pgDocuments).values({
    id: record.id,
    userId: record.userId,
    title: record.title,
    filename: record.filename,
    kind: record.kind,
    mimeType: record.mimeType,
    blobPathname: record.blobPathname,
    blobUrl: record.blobUrl,
    size: record.size,
    isPublic: record.isPublic,
    shareId: record.shareId,
    visibility: record.visibility,
    folderId: record.folderId,
    createdAt: asDate(record.createdAt),
    updatedAt: asDate(record.updatedAt),
  });
  return record;
}

export async function updateDocument(
  userId: string,
  documentId: string,
  patch: Partial<
    Pick<
      DocumentRecord,
      | "title"
      | "filename"
      | "kind"
      | "mimeType"
      | "blobPathname"
      | "blobUrl"
      | "size"
      | "isPublic"
      | "folderId"
      | "visibility"
    >
  >,
): Promise<DocumentRecord | null> {
  const current = await getDocument(userId, documentId);
  if (!current) return null;
  const [row] = await getNeonDb()
    .update(pgDocuments)
    .set({ ...patch, updatedAt: nowDate() })
    .where(eq(pgDocuments.id, documentId))
    .returning();
  return row ? mapDocument(row) : null;
}

export async function deleteDocument(
  userId: string,
  documentId: string,
): Promise<DocumentRecord | null> {
  const current = await getDocument(userId, documentId);
  if (!current || current.userId !== userId) return null;
  await getNeonDb()
    .delete(pgDocuments)
    .where(and(eq(pgDocuments.userId, userId), eq(pgDocuments.id, documentId)));
  await getNeonDb()
    .delete(pgDocumentSessions)
    .where(eq(pgDocumentSessions.documentId, documentId));
  return current;
}

export async function listChatDocuments(userId: string, chatId: string): Promise<DocumentRecord[]> {
  const rows = await getNeonDb()
    .select({ document: pgDocuments })
    .from(pgDocumentSessions)
    .innerJoin(pgDocuments, eq(pgDocuments.id, pgDocumentSessions.documentId))
    .where(
      and(
        eq(pgDocumentSessions.chatId, chatId),
        or(eq(pgDocuments.userId, userId), inArray(pgDocuments.visibility, LIBRARY_SHARE_VALUES)),
      ),
    )
    .orderBy(desc(pgDocuments.updatedAt));
  return rows.map((row) => mapDocument(row.document));
}

export async function listDocumentChats(userId: string, documentId: string): Promise<ChatRecord[]> {
  const document = await getDocument(userId, documentId);
  if (!document) return [];
  const rows = await getNeonDb()
    .select({ chat: pgChats })
    .from(pgDocumentSessions)
    .innerJoin(pgChats, eq(pgChats.id, pgDocumentSessions.chatId))
    .where(and(eq(pgDocumentSessions.documentId, documentId), eq(pgChats.userId, userId)))
    .orderBy(desc(pgChats.updatedAt));
  return rows.map((row) => mapChat(row.chat));
}

export async function attachDocument(
  userId: string,
  documentId: string,
  chatId: string,
): Promise<boolean> {
  const document = await getDocument(userId, documentId);
  const chat = await getChat(userId, chatId);
  if (!document || !chat) return false;
  const [existing] = await getNeonDb()
    .select()
    .from(pgDocumentSessions)
    .where(
      and(eq(pgDocumentSessions.documentId, documentId), eq(pgDocumentSessions.chatId, chatId)),
    )
    .limit(1);
  if (existing) return true;
  await getNeonDb().insert(pgDocumentSessions).values({
    documentId,
    chatId,
    createdAt: nowDate(),
  });
  return true;
}

export async function detachDocument(
  userId: string,
  documentId: string,
  chatId: string,
): Promise<boolean> {
  const document = await getDocument(userId, documentId);
  if (!document) return false;
  const deleted = await getNeonDb()
    .delete(pgDocumentSessions)
    .where(
      and(eq(pgDocumentSessions.documentId, documentId), eq(pgDocumentSessions.chatId, chatId)),
    )
    .returning({ documentId: pgDocumentSessions.documentId });
  return deleted.length > 0;
}

function asEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map(Number).filter((entry) => Number.isFinite(entry));
  }
  if (typeof value === "string") {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((entry) => Number.isFinite(entry));
  }
  return [];
}

function mapEmbedding(row: typeof pgEmbeddings.$inferSelect): EmbeddingRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as EmbeddingKind,
    sourceType: row.sourceType as EmbeddingSourceType,
    sourceId: row.sourceId,
    turnId: row.turnId,
    text: row.text,
    embedding: asEmbedding(row.embedding),
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  };
}

export async function upsertEmbedding(input: CreateEmbeddingInput): Promise<EmbeddingRecord> {
  const turnMatch = input.turnId ? eq(pgEmbeddings.turnId, input.turnId) : isNull(pgEmbeddings.turnId);
  const [existing] = await getNeonDb()
    .select()
    .from(pgEmbeddings)
    .where(
      and(
        eq(pgEmbeddings.userId, input.userId),
        eq(pgEmbeddings.kind, input.kind),
        eq(pgEmbeddings.sourceId, input.sourceId),
        turnMatch,
      ),
    )
    .limit(1);
  const timestamp = nowDate();
  if (!existing) {
    const record = newEmbeddingRecord(input, nowIso(timestamp));
    const [row] = await getNeonDb()
      .insert(pgEmbeddings)
      .values({
        ...record,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    if (!row) throw new Error("Failed to create embedding.");
    return mapEmbedding(row);
  }
  const next = applyEmbeddingUpdate(mapEmbedding(existing), input, nowIso(timestamp));
  const [row] = await getNeonDb()
    .update(pgEmbeddings)
    .set({
      text: next.text,
      embedding: next.embedding,
      sourceType: next.sourceType,
      updatedAt: timestamp,
    })
    .where(eq(pgEmbeddings.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update embedding.");
  return mapEmbedding(row);
}

export async function listUserEmbeddings(
  userId: string,
  kinds?: readonly EmbeddingKind[],
): Promise<EmbeddingRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgEmbeddings)
    .where(
      kinds && kinds.length > 0
        ? and(eq(pgEmbeddings.userId, userId), inArray(pgEmbeddings.kind, [...kinds]))
        : eq(pgEmbeddings.userId, userId),
    );
  return rows.map(mapEmbedding);
}

export async function deleteEmbeddingsForSource(
  userId: string,
  sourceType: EmbeddingSourceType,
  sourceId: string,
): Promise<void> {
  await getNeonDb()
    .delete(pgEmbeddings)
    .where(
      and(
        eq(pgEmbeddings.userId, userId),
        eq(pgEmbeddings.sourceType, sourceType),
        eq(pgEmbeddings.sourceId, sourceId),
      ),
    );
}

function mapSessionCitationSet(
  row: typeof pgSessionCitations.$inferSelect,
): SessionCitationSet {
  return {
    id: row.id,
    userId: row.userId,
    chatId: row.chatId,
    queryText: row.queryText,
    citations: row.citations,
    createdAt: toIso(row.createdAt) ?? "",
  };
}

export async function upsertSessionCitationSet(
  input: UpsertCitationInput,
): Promise<SessionCitationSet> {
  const [existing] = await getNeonDb()
    .select()
    .from(pgSessionCitations)
    .where(
      and(
        eq(pgSessionCitations.userId, input.userId),
        eq(pgSessionCitations.chatId, input.chatId),
        eq(pgSessionCitations.queryText, input.queryText),
      ),
    )
    .limit(1);

  if (!existing) {
    const record = newCitationSet(input);
    const [row] = await getNeonDb()
      .insert(pgSessionCitations)
      .values({
        ...record,
        createdAt: asDate(record.createdAt),
      })
      .returning();
    if (!row) throw new Error("Failed to save session citations.");
    return mapSessionCitationSet(row);
  }

  const next = applyCitationUpdate(mapSessionCitationSet(existing), input.citations);
  const [row] = await getNeonDb()
    .update(pgSessionCitations)
    .set({ citations: next.citations })
    .where(eq(pgSessionCitations.id, existing.id))
    .returning();
  if (!row) throw new Error("Failed to update session citations.");
  return mapSessionCitationSet(row);
}

export async function listSessionCitationSets(
  userId: string,
  chatId: string,
): Promise<SessionCitationSet[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgSessionCitations)
    .where(
      and(eq(pgSessionCitations.userId, userId), eq(pgSessionCitations.chatId, chatId)),
    );
  return rows.map(mapSessionCitationSet);
}

function mapUsageRecord(row: typeof pgUsageEvents.$inferSelect): UsageRecord {
  return {
    id: row.id,
    userId: row.userId,
    chatId: row.chatId,
    purpose: row.purpose as UsageRecord["purpose"],
    modelId: row.modelId,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    reasoningTokens: row.reasoningTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    costUsd: row.costUsd,
    createdAt: toIso(row.createdAt) ?? "",
  };
}

export async function upsertUsageRecord(record: UsageRecord): Promise<UsageRecord> {
  const [row] = await getNeonDb()
    .insert(pgUsageEvents)
    .values({
      id: record.id,
      userId: record.userId,
      chatId: record.chatId,
      purpose: record.purpose,
      modelId: record.modelId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      reasoningTokens: record.reasoningTokens,
      cacheReadTokens: record.cacheReadTokens,
      cacheWriteTokens: record.cacheWriteTokens,
      costUsd: record.costUsd,
      createdAt: asDate(record.createdAt),
    })
    .onConflictDoUpdate({
      target: pgUsageEvents.id,
      set: {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        reasoningTokens: record.reasoningTokens,
        cacheReadTokens: record.cacheReadTokens,
        cacheWriteTokens: record.cacheWriteTokens,
        costUsd: record.costUsd,
        modelId: record.modelId,
        purpose: record.purpose,
        chatId: record.chatId,
      },
    })
    .returning();
  if (!row) throw new Error("Failed to record usage.");
  return mapUsageRecord(row);
}

export async function listUserUsage(userId: string): Promise<UsageRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgUsageEvents)
    .where(eq(pgUsageEvents.userId, userId))
    .orderBy(desc(pgUsageEvents.createdAt));
  return rows.map(mapUsageRecord);
}

export async function listAccountUsage(): Promise<UsageRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgUsageEvents)
    .orderBy(desc(pgUsageEvents.createdAt));
  return rows.map(mapUsageRecord);
}

export async function listChatUsage(userId: string, chatId: string): Promise<UsageRecord[]> {
  const rows = await getNeonDb()
    .select()
    .from(pgUsageEvents)
    .where(and(eq(pgUsageEvents.userId, userId), eq(pgUsageEvents.chatId, chatId)))
    .orderBy(desc(pgUsageEvents.createdAt));
  return rows.map(mapUsageRecord);
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapEmail(row: typeof pgEmails.$inferSelect): EmailRecord {
  return normalizeEmail({
    id: row.id,
    userId: row.userId,
    direction: row.direction as EmailDirection,
    fromAddress: row.fromAddress,
    toAddresses: asStringList(row.toAddresses),
    ccAddresses: asStringList(row.ccAddresses),
    subject: row.subject,
    bodyText: row.bodyText ?? "",
    bodyHtml: row.bodyHtml ?? "",
    resendEmailId: row.resendEmailId,
    status: row.status as EmailRecord["status"],
    hasActionItem: row.hasActionItem,
    actionSummary: row.actionSummary,
    chatId: row.chatId,
    inReplyTo: row.inReplyTo,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    createdAt: toIso(row.createdAt) ?? "",
    updatedAt: toIso(row.updatedAt) ?? "",
  });
}

export async function listEmails(
  userId: string,
  options?: { direction?: EmailDirection; limit?: number },
): Promise<EmailRecord[]> {
  const limit = options?.limit ?? EMAIL_LIST_DEFAULT_LIMIT;
  const rows = await getNeonDb()
    .select()
    .from(pgEmails)
    .where(
      and(
        eq(pgEmails.userId, userId),
        options?.direction ? eq(pgEmails.direction, options.direction) : undefined,
      ),
    )
    .orderBy(desc(pgEmails.createdAt))
    .limit(limit);
  return rows.map(mapEmail);
}

export async function getEmail(userId: string, emailId: string): Promise<EmailRecord | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgEmails)
    .where(and(eq(pgEmails.id, emailId), eq(pgEmails.userId, userId)))
    .limit(1);
  return row ? mapEmail(row) : null;
}

export async function getEmailByResendId(resendEmailId: string): Promise<EmailRecord | null> {
  const [row] = await getNeonDb()
    .select()
    .from(pgEmails)
    .where(eq(pgEmails.resendEmailId, resendEmailId))
    .limit(1);
  return row ? mapEmail(row) : null;
}

export async function createEmail(input: CreateEmailInput): Promise<EmailRecord> {
  const email = newEmailRecord(input);
  await getNeonDb().insert(pgEmails).values({
    ...email,
    createdAt: asDate(email.createdAt),
    updatedAt: asDate(email.updatedAt),
  });
  return email;
}

export async function updateEmail(
  userId: string,
  emailId: string,
  patch: EmailPatch,
): Promise<EmailRecord | null> {
  const [row] = await getNeonDb()
    .update(pgEmails)
    .set({ ...patch, updatedAt: nowDate() })
    .where(and(eq(pgEmails.id, emailId), eq(pgEmails.userId, userId)))
    .returning();
  return row ? mapEmail(row) : null;
}
