import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ChatEventRecord,
  ChatPatch,
  ChatRecord,
  ChatSource,
  DocumentFolder,
  DocumentRecord,
  DocumentSessionLink,
  EmailDirection,
  EmailRecord,
  ScheduledJob,
  EmbeddingKind,
  EmbeddingRecord,
  EmbeddingSearchHit,
  EmbeddingSearchInput,
  EmbeddingSourceType,
  SessionCitationSet,
  UsageRecord,
  UserSettings,
  UserSkill,
} from "@/lib/types";
import { normalizeInboundMailToken } from "@/lib/inbound-mail-token";
import { parseJobCadence } from "@/lib/job-cadence";
import {
  applyChatPatch,
  applyCitationUpdate,
  applyEmbeddingUpdate,
  applySettingsPatch,
  applyEmailPatch,
  applyJobLease,
  applyJobPatch,
  chatEventRecord,
  chatEventRecords,
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
  holdsJobLease,
  isJobClaimable,
  isManualJobClaimable,
  mergedUsageRecord,
  newChatRecord,
  newCitationSet,
  newEmailRecord,
  newEmbeddingRecord,
  newJobRecord,
  newSkillRecord,
  normalizeChat,
  normalizeEmail,
  releasedJobFields,
  sameCitationKey,
  sameEmbeddingKey,
  scoreEmbeddingRecords,
} from "@/lib/store-logic";
import { isVisibleToViewer, normalizeLibraryVisibility, normalizeVisibility } from "@/lib/visibility";

type AppData = {
  chats: ChatRecord[];
  chatEvents: ChatEventRecord[];
  settings: UserSettings[];
  skills: UserSkill[];
  jobs: ScheduledJob[];
  documents: DocumentRecord[];
  documentFolders: DocumentFolder[];
  documentSessions: DocumentSessionLink[];
  embeddings: EmbeddingRecord[];
  sessionCitations: SessionCitationSet[];
  usageEvents: UsageRecord[];
  emails: EmailRecord[];
};

const empty: AppData = {
  chats: [],
  chatEvents: [],
  settings: [],
  skills: [],
  jobs: [],
  documents: [],
  documentFolders: [],
  documentSessions: [],
  embeddings: [],
  sessionCitations: [],
  usageEvents: [],
  emails: [],
};

const filePath = path.join(process.cwd(), ".data", "app.json");

function load(): AppData {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AppData>;
    return {
      ...empty,
      ...parsed,
      chats: (parsed.chats ?? []).map(normalizeChat),
      documents: (parsed.documents ?? []).map((document) => {
        const visibility = normalizeLibraryVisibility(document.visibility, document.isPublic);
        return {
          ...document,
          folderId: document.folderId ?? null,
          isPublic: visibility === "public",
          visibility,
        };
      }),
      documentFolders: (parsed.documentFolders ?? []).map((folder) => ({
        ...folder,
        visibility: normalizeLibraryVisibility(folder.visibility),
      })),
      skills: (parsed.skills ?? []).map((skill) => ({
        ...skill,
        name: skill.name ?? "",
        visibility: normalizeVisibility(skill.visibility),
      })),
      jobs: (parsed.jobs ?? []).map((job) => ({
        ...job,
        cadence: parseJobCadence(job.cadence),
        visibility: normalizeVisibility(job.visibility),
      })),
      documentSessions: parsed.documentSessions ?? [],
      embeddings: parsed.embeddings ?? [],
      sessionCitations: parsed.sessionCitations ?? [],
      usageEvents: parsed.usageEvents ?? [],
      emails: parsed.emails ?? [],
    };
  } catch {
    return structuredClone(empty);
  }
}

function save(data: AppData) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

export function getUserSettings(userId: string): UserSettings {
  const data = load();
  const row = data.settings.find((item) => item.userId === userId);
  return row ? settingsFromStored(row) : defaultSettings(userId);
}

export function upsertUserSettings(
  userId: string,
  patch: Partial<Pick<UserSettings, "modelTier" | "instructionOverlay" | "inboundMailToken">>,
): UserSettings {
  const data = load();
  const current = data.settings.find((row) => row.userId === userId) ?? defaultSettings(userId);
  const next = applySettingsPatch(current, patch);
  data.settings = [...data.settings.filter((row) => row.userId !== userId), next];
  save(data);
  return next;
}

export function findUserIdByInboundMailToken(token: string): string | null {
  const normalized = normalizeInboundMailToken(token);
  if (!normalized) return null;
  const row = load().settings.find((item) => item.inboundMailToken === normalized);
  return row?.userId ?? null;
}

export function listChats(userId: string): ChatRecord[] {
  return load()
    .chats.filter((chat) => chat.userId === userId)
    .map(normalizeChat)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listAccountChats(): ChatRecord[] {
  return load()
    .chats.map(normalizeChat)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getChat(userId: string, chatId: string): ChatRecord | null {
  const chat = load().chats.find((row) => row.userId === userId && row.id === chatId);
  return chat ? normalizeChat(chat) : null;
}

export function createChat(
  userId: string,
  title: string,
  source: ChatSource = "web",
): ChatRecord {
  const data = load();
  const chat = newChatRecord(userId, title, source);
  data.chats.unshift(chat);
  save(data);
  return chat;
}

export function updateChat(
  userId: string,
  chatId: string,
  patch: ChatPatch,
): ChatRecord | null {
  const data = load();
  const index = data.chats.findIndex((chat) => chat.userId === userId && chat.id === chatId);
  if (index === -1) return null;
  data.chats[index] = applyChatPatch(data.chats[index], patch);
  save(data);
  return data.chats[index];
}

export function deleteChat(userId: string, chatId: string): boolean {
  const data = load();
  const before = data.chats.length;
  data.chats = data.chats.filter((chat) => !(chat.userId === userId && chat.id === chatId));
  data.chatEvents = data.chatEvents.filter((event) => event.chatId !== chatId);
  data.documentSessions = data.documentSessions.filter((link) => link.chatId !== chatId);
  data.embeddings = data.embeddings.filter(
    (row) => !(row.userId === userId && row.sourceType === "session" && row.sourceId === chatId),
  );
  data.sessionCitations = data.sessionCitations.filter(
    (row) => !(row.userId === userId && row.chatId === chatId),
  );
  save(data);
  return data.chats.length < before;
}

export function getChatByEveSessionId(
  userId: string,
  eveSessionId: string,
): ChatRecord | null {
  const chat = load().chats.find(
    (row) => row.userId === userId && row.sessionId === eveSessionId,
  );
  return chat ? normalizeChat(chat) : null;
}

export function listChatOwnersForEveSession(eveSessionId: string): string[] {
  return [
    ...new Set(
      load()
        .chats.filter((row) => row.sessionId === eveSessionId)
        .map((row) => row.userId),
    ),
  ];
}

export function listChatEvents(chatId: string): ChatEventRecord[] {
  return load()
    .chatEvents.filter((event) => event.chatId === chatId)
    .sort((a, b) => a.index - b.index);
}

export function upsertChatEvent(chatId: string, index: number, event: unknown) {
  const data = load();
  const existing = data.chatEvents.findIndex((row) => row.chatId === chatId && row.index === index);
  const record = chatEventRecord(chatId, index, event);
  if (existing === -1) data.chatEvents.push(record);
  else data.chatEvents[existing] = record;
  save(data);
}

export function replaceChatEvents(chatId: string, events: unknown[]) {
  const data = load();
  data.chatEvents = [
    ...data.chatEvents.filter((event) => event.chatId !== chatId),
    ...chatEventRecords(chatId, events),
  ];
  save(data);
}

export function listUserSkills(userId: string): UserSkill[] {
  return load().skills.filter((skill) => skill.userId === userId);
}

export function createUserSkill(userId: string, input: CreateSkillInput): UserSkill {
  const data = load();
  const skill = newSkillRecord(userId, input);
  data.skills.push(skill);
  save(data);
  return skill;
}

export function updateUserSkill(
  userId: string,
  skillId: string,
  patch: Partial<Pick<UserSkill, "name" | "slug" | "description" | "markdown" | "enabled" | "visibility">>,
): UserSkill | null {
  const data = load();
  const index = data.skills.findIndex((skill) => skill.userId === userId && skill.id === skillId);
  if (index === -1) return null;
  data.skills[index] = { ...data.skills[index], ...patch, updatedAt: now() };
  save(data);
  return data.skills[index];
}

export function deleteUserSkill(userId: string, skillId: string): boolean {
  const data = load();
  const before = data.skills.length;
  data.skills = data.skills.filter((skill) => !(skill.userId === userId && skill.id === skillId));
  save(data);
  return data.skills.length < before;
}

export function listJobs(userId: string): ScheduledJob[] {
  return load()
    .jobs.filter((job) => job.userId === userId)
    .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));
}

export function createJob(userId: string, input: CreateJobInput): ScheduledJob {
  const data = load();
  const job = newJobRecord(userId, input);
  data.jobs.push(job);
  save(data);
  return job;
}

export function updateJob(userId: string, jobId: string, patch: JobPatch): ScheduledJob | null {
  const data = load();
  const index = data.jobs.findIndex((job) => job.userId === userId && job.id === jobId);
  if (index === -1) return null;
  data.jobs[index] = applyJobPatch(data.jobs[index], patch);
  save(data);
  return data.jobs[index];
}

export function deleteJob(userId: string, jobId: string): boolean {
  const data = load();
  const before = data.jobs.length;
  data.jobs = data.jobs.filter((job) => !(job.userId === userId && job.id === jobId));
  save(data);
  return data.jobs.length < before;
}

export function claimDueJobs(options: {
  now: Date;
  limit: number;
  leaseForMs: number;
}): ScheduledJob[] {
  const data = load();
  const current = options.now.toISOString();
  const leaseUntil = new Date(options.now.getTime() + options.leaseForMs).toISOString();
  const claimed: ScheduledJob[] = [];

  for (let index = 0; index < data.jobs.length; index += 1) {
    if (claimed.length >= options.limit) break;
    const job = data.jobs[index];
    if (!isJobClaimable(job, current)) continue;
    data.jobs[index] = applyJobLease(job, randomUUID(), leaseUntil);
    claimed.push(data.jobs[index]);
  }

  save(data);
  return claimed;
}

export function claimJob(
  jobId: string,
  options: { now: Date; leaseForMs: number },
): ScheduledJob | null {
  const data = load();
  const current = options.now.toISOString();
  const index = data.jobs.findIndex((row) => row.id === jobId);
  if (index === -1 || !isManualJobClaimable(data.jobs[index], current)) return null;
  data.jobs[index] = applyJobLease(
    data.jobs[index],
    randomUUID(),
    new Date(options.now.getTime() + options.leaseForMs).toISOString(),
  );
  save(data);
  return data.jobs[index];
}

export function completeJob(job: ScheduledJob): boolean {
  const data = load();
  const index = data.jobs.findIndex((row) => row.id === job.id);
  if (index === -1 || !holdsJobLease(data.jobs[index], job)) return false;
  const mutation = completeJobMutation(data.jobs[index]);
  if (mutation.action === "delete") {
    data.jobs.splice(index, 1);
    save(data);
    return true;
  }
  data.jobs[index] = {
    ...data.jobs[index],
    enabled: mutation.enabled,
    nextRunAt: mutation.nextRunAt ?? data.jobs[index].nextRunAt,
    leaseToken: mutation.leaseToken,
    leaseUntil: mutation.leaseUntil,
    lastError: mutation.lastError,
    updatedAt: now(),
  };
  save(data);
  return true;
}

export function releaseJob(job: ScheduledJob, error: string, retryAt?: Date | null): boolean {
  const data = load();
  const index = data.jobs.findIndex((row) => row.id === job.id);
  if (index === -1 || !holdsJobLease(data.jobs[index], job)) return false;
  data.jobs[index] = {
    ...data.jobs[index],
    ...releasedJobFields(error, retryAt?.toISOString() ?? null),
  };
  save(data);
  return true;
}

export function listDocuments(userId: string): DocumentRecord[] {
  return load()
    .documents.filter((document) => isVisibleToViewer(document, userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listFolders(userId: string): DocumentFolder[] {
  return load()
    .documentFolders.filter((folder) => isVisibleToViewer(folder, userId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getFolder(userId: string, folderId: string): DocumentFolder | null {
  const folder = load().documentFolders.find((row) => row.id === folderId);
  return folder && isVisibleToViewer(folder, userId) ? folder : null;
}

export function createFolder(record: DocumentFolder): DocumentFolder {
  const data = load();
  data.documentFolders.unshift(record);
  save(data);
  return record;
}

export function updateFolder(
  userId: string,
  folderId: string,
  patch: Partial<Pick<DocumentFolder, "name" | "description" | "parentId" | "visibility">>,
): DocumentFolder | null {
  const data = load();
  const index = data.documentFolders.findIndex(
    (folder) => folder.userId === userId && folder.id === folderId,
  );
  if (index === -1) return null;
  data.documentFolders[index] = { ...data.documentFolders[index], ...patch, updatedAt: now() };
  save(data);
  return data.documentFolders[index];
}

export function deleteFolder(userId: string, folderId: string): DocumentFolder | null {
  const data = load();
  const folder = data.documentFolders.find((row) => row.userId === userId && row.id === folderId);
  if (!folder) return null;
  const parentId = folder.parentId;
  data.documentFolders = data.documentFolders
    .filter((row) => row.id !== folderId)
    .map((row) => (row.parentId === folderId ? { ...row, parentId, updatedAt: now() } : row));
  data.documents = data.documents.map((document) =>
    document.folderId === folderId ? { ...document, folderId: parentId, updatedAt: now() } : document,
  );
  save(data);
  return folder;
}

export function getDocument(userId: string, documentId: string): DocumentRecord | null {
  const document = load().documents.find((row) => row.id === documentId);
  return document && isVisibleToViewer(document, userId) ? document : null;
}

export function getPublicDocument(shareId: string): DocumentRecord | null {
  const document = load().documents.find((row) => row.shareId === shareId);
  return document?.isPublic ? document : null;
}

export function createDocument(record: DocumentRecord): DocumentRecord {
  const data = load();
  data.documents.unshift(record);
  save(data);
  return record;
}

export function updateDocument(
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
): DocumentRecord | null {
  const data = load();
  const index = data.documents.findIndex((document) => document.id === documentId);
  if (index === -1 || !isVisibleToViewer(data.documents[index], userId)) return null;
  data.documents[index] = { ...data.documents[index], ...patch, updatedAt: now() };
  save(data);
  return data.documents[index];
}

export function deleteDocument(userId: string, documentId: string): DocumentRecord | null {
  const data = load();
  const document = data.documents.find((row) => row.userId === userId && row.id === documentId);
  if (!document) return null;
  data.documents = data.documents.filter((row) => row.id !== documentId);
  data.documentSessions = data.documentSessions.filter((link) => link.documentId !== documentId);
  save(data);
  return document;
}

export function listChatDocuments(userId: string, chatId: string): DocumentRecord[] {
  const data = load();
  const ids = new Set(
    data.documentSessions.filter((link) => link.chatId === chatId).map((link) => link.documentId),
  );
  return data.documents
    .filter((document) => ids.has(document.id) && isVisibleToViewer(document, userId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listDocumentChats(userId: string, documentId: string): ChatRecord[] {
  const data = load();
  const document = data.documents.find((row) => row.id === documentId);
  if (!document || !isVisibleToViewer(document, userId)) return [];
  const chatIds = new Set(
    data.documentSessions
      .filter((link) => link.documentId === documentId)
      .map((link) => link.chatId),
  );
  return data.chats
    .filter((chat) => chat.userId === userId && chatIds.has(chat.id))
    .map(normalizeChat)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function attachDocument(
  userId: string,
  documentId: string,
  chatId: string,
): boolean {
  const data = load();
  const document = data.documents.find((row) => row.id === documentId);
  const chat = data.chats.find((row) => row.userId === userId && row.id === chatId);
  if (!document || !chat || !isVisibleToViewer(document, userId)) return false;
  if (data.documentSessions.some((link) => link.documentId === documentId && link.chatId === chatId)) {
    return true;
  }
  data.documentSessions.push({ documentId, chatId, createdAt: now() });
  save(data);
  return true;
}

export function detachDocument(
  userId: string,
  documentId: string,
  chatId: string,
): boolean {
  const data = load();
  const document = data.documents.find((row) => row.id === documentId);
  if (!document || !isVisibleToViewer(document, userId)) return false;
  const before = data.documentSessions.length;
  data.documentSessions = data.documentSessions.filter(
    (link) => !(link.documentId === documentId && link.chatId === chatId),
  );
  save(data);
  return data.documentSessions.length < before;
}

export function upsertEmbedding(input: CreateEmbeddingInput): EmbeddingRecord {
  const data = load();
  const index = data.embeddings.findIndex((row) => sameEmbeddingKey(row, input));
  const timestamp = now();
  if (index === -1) {
    const record = newEmbeddingRecord(input, timestamp);
    data.embeddings.push(record);
    save(data);
    return record;
  }
  data.embeddings[index] = applyEmbeddingUpdate(data.embeddings[index], input, timestamp);
  save(data);
  return data.embeddings[index];
}

export function listUserEmbeddings(
  userId: string,
  kinds?: readonly EmbeddingKind[],
): EmbeddingRecord[] {
  return load().embeddings.filter(
    (row) => row.userId === userId && (!kinds || kinds.includes(row.kind)),
  );
}

export function searchUserEmbeddings(input: EmbeddingSearchInput): EmbeddingSearchHit[] {
  return scoreEmbeddingRecords(load().embeddings, input);
}

export function deleteEmbeddingsForSource(
  userId: string,
  sourceType: EmbeddingSourceType,
  sourceId: string,
): void {
  const data = load();
  data.embeddings = data.embeddings.filter(
    (row) =>
      !(row.userId === userId && row.sourceType === sourceType && row.sourceId === sourceId),
  );
  save(data);
}

export function upsertSessionCitationSet(input: UpsertCitationInput): SessionCitationSet {
  const data = load();
  const index = data.sessionCitations.findIndex((row) => sameCitationKey(row, input));
  const timestamp = now();
  if (index === -1) {
    const record = newCitationSet(input, timestamp);
    data.sessionCitations.push(record);
    save(data);
    return record;
  }
  data.sessionCitations[index] = applyCitationUpdate(data.sessionCitations[index], input.citations);
  save(data);
  return data.sessionCitations[index];
}

export function listSessionCitationSets(
  userId: string,
  chatId: string,
): SessionCitationSet[] {
  return load().sessionCitations.filter(
    (row) => row.userId === userId && row.chatId === chatId,
  );
}

export function upsertUsageRecord(record: UsageRecord): UsageRecord {
  const data = load();
  const index = data.usageEvents.findIndex((row) => row.id === record.id);
  const next = mergedUsageRecord(index === -1 ? undefined : data.usageEvents[index], record);
  if (index === -1) data.usageEvents.push(next);
  else data.usageEvents[index] = next;
  save(data);
  return next;
}

export function listUserUsage(userId: string): UsageRecord[] {
  return load()
    .usageEvents.filter((row) => row.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listAccountUsage(): UsageRecord[] {
  return load()
    .usageEvents.slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listChatUsage(userId: string, chatId: string): UsageRecord[] {
  return load()
    .usageEvents.filter((row) => row.userId === userId && row.chatId === chatId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listEmails(
  userId: string,
  options?: { direction?: EmailDirection; limit?: number },
): EmailRecord[] {
  const limit = options?.limit ?? EMAIL_LIST_DEFAULT_LIMIT;
  return load()
    .emails.filter(
      (row) => row.userId === userId && (!options?.direction || row.direction === options.direction),
    )
    .map(normalizeEmail)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

export function getEmail(userId: string, emailId: string): EmailRecord | null {
  const email = load().emails.find((row) => row.userId === userId && row.id === emailId);
  return email ? normalizeEmail(email) : null;
}

export function getEmailByResendId(resendEmailId: string): EmailRecord | null {
  const email = load().emails.find((row) => row.resendEmailId === resendEmailId);
  return email ? normalizeEmail(email) : null;
}

export function createEmail(input: CreateEmailInput): EmailRecord {
  const data = load();
  const email = newEmailRecord(input);
  data.emails.unshift(email);
  save(data);
  return email;
}

export function updateEmail(userId: string, emailId: string, patch: EmailPatch): EmailRecord | null {
  const data = load();
  const index = data.emails.findIndex((row) => row.userId === userId && row.id === emailId);
  if (index === -1) return null;
  data.emails[index] = applyEmailPatch(data.emails[index], patch);
  save(data);
  return data.emails[index];
}
