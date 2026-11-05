// Shared store rules. Neon and local JSON both apply these; I/O stays in each backend.
import { randomUUID } from "node:crypto";
import { cosineSimilarity } from "@/lib/embeddings";
import { advanceJobAfterRun, isOneOffJob, parseJobCadence } from "@/lib/job-cadence";
import { titleForSkillOnlyPrompt } from "@/lib/skill-mention";
import {
  normalizeChatSource,
  type ChatPatch,
  type ChatEventRecord,
  type ChatRecord,
  type ChatSource,
  type EmailRecord,
  type EmbeddingKind,
  type EmbeddingRecord,
  type EmbeddingSearchHit,
  type EmbeddingSearchInput,
  type ScheduledJob,
  type SessionCitationSet,
  type UsageRecord,
  type UserSettings,
  type UserSkill,
} from "@/lib/types";
import { normalizeVisibility } from "@/lib/visibility";

export const EMAIL_LIST_DEFAULT_LIMIT = 200;

export type CreateSkillInput = Pick<UserSkill, "name" | "slug" | "description" | "markdown"> & {
  enabled?: boolean;
  visibility?: UserSkill["visibility"];
};

export type CreateJobInput = Pick<
  ScheduledJob,
  "prompt" | "firstRunAt" | "everyMinutes" | "authenticator" | "issuer"
> & {
  cadence?: ScheduledJob["cadence"];
  visibility?: ScheduledJob["visibility"];
};

export type JobPatch = Partial<
  Pick<
    ScheduledJob,
    "prompt" | "nextRunAt" | "everyMinutes" | "cadence" | "enabled" | "lastError" | "visibility"
  >
>;

export type CreateEmailInput = Omit<EmailRecord, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type EmailPatch = Partial<
  Pick<
    EmailRecord,
    | "status"
    | "hasActionItem"
    | "actionSummary"
    | "chatId"
    | "resendEmailId"
    | "bodyText"
    | "bodyHtml"
  >
>;

export type CreateEmbeddingInput = Omit<EmbeddingRecord, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

export type UpsertCitationInput = {
  userId: string;
  chatId: string;
  queryText: string;
  citations: SessionCitationSet["citations"];
};

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

export function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export function defaultSettings(userId: string): UserSettings {
  return { userId, modelTier: "auto", instructionOverlay: "", inboundMailToken: null };
}

export function settingsFromStored(row: {
  userId: string;
  modelTier: string;
  instructionOverlay: string;
  inboundMailToken?: string | null;
}): UserSettings {
  return {
    userId: row.userId,
    modelTier: row.modelTier as UserSettings["modelTier"],
    instructionOverlay: row.instructionOverlay,
    inboundMailToken: row.inboundMailToken?.trim() || null,
  };
}

export function applySettingsPatch(
  current: UserSettings,
  patch: Partial<Pick<UserSettings, "modelTier" | "instructionOverlay" | "inboundMailToken">>,
): UserSettings {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return settingsFromStored({ ...current, ...defined, userId: current.userId });
}

export function titleFromPrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  const skillTitle = titleForSkillOnlyPrompt(trimmed);
  if (skillTitle) return skillTitle;
  return trimmed.length > 56 ? `${trimmed.slice(0, 53)}…` : trimmed || "New session";
}

export function normalizeChat(chat: ChatRecord): ChatRecord {
  return {
    ...chat,
    description: chat.description ?? "",
    source: normalizeChatSource(chat.source),
  };
}

export function newChatRecord(
  userId: string,
  title: string,
  source: ChatSource = "web",
  stamp = nowIso(),
  id: string = randomUUID(),
): ChatRecord {
  return normalizeChat({
    id,
    userId,
    title,
    description: "",
    source,
    sessionId: null,
    streamIndex: 0,
    createdAt: stamp,
    updatedAt: stamp,
  });
}

/**
 * Pick only the fields a chat patch may change. Callers pass request bodies
 * here, so anything else (userId, id, createdAt, source) is dropped rather
 * than written through.
 */
export function chatPatchFields(patch: ChatPatch): Omit<ChatPatch, "touchUpdatedAt"> {
  const input = (patch ?? {}) as Record<string, unknown>;
  const fields: Omit<ChatPatch, "touchUpdatedAt"> = {};
  if (typeof input.title === "string") fields.title = input.title;
  if (typeof input.description === "string") fields.description = input.description;
  if (typeof input.sessionId === "string" || input.sessionId === null) {
    fields.sessionId = input.sessionId as string | null;
  }
  if (typeof input.streamIndex === "number" && Number.isInteger(input.streamIndex)) {
    fields.streamIndex = Math.max(0, input.streamIndex);
  }
  return fields;
}

export function applyChatPatch(chat: ChatRecord, patch: ChatPatch, stamp = nowIso()): ChatRecord {
  return normalizeChat({
    ...chat,
    ...chatPatchFields(patch),
    updatedAt: patch.touchUpdatedAt ? stamp : chat.updatedAt,
  });
}

export function chatEventId(chatId: string, index: number): string {
  return `${chatId}:${index}`;
}

export function chatEventRecord(chatId: string, index: number, event: unknown): ChatEventRecord {
  return { id: chatEventId(chatId, index), chatId, index, event };
}

export function chatEventRecords(
  chatId: string,
  events: unknown[],
  startIndex = 0,
): ChatEventRecord[] {
  return events.map((event, index) => chatEventRecord(chatId, startIndex + index, event));
}

export function newSkillRecord(
  userId: string,
  input: CreateSkillInput,
  stamp = nowIso(),
  id: string = randomUUID(),
): UserSkill {
  return {
    id,
    userId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    markdown: input.markdown,
    enabled: input.enabled ?? true,
    visibility: normalizeVisibility(input.visibility, "private"),
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function newJobRecord(
  userId: string,
  input: CreateJobInput,
  stamp = nowIso(),
  id: string = randomUUID(),
): ScheduledJob {
  return {
    id,
    userId,
    prompt: input.prompt,
    firstRunAt: input.firstRunAt,
    nextRunAt: input.firstRunAt,
    everyMinutes: input.everyMinutes,
    cadence: parseJobCadence(input.cadence),
    visibility: "private",
    enabled: true,
    leaseToken: null,
    leaseUntil: null,
    lastError: null,
    authenticator: input.authenticator,
    issuer: input.issuer,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** `undefined` means leave the stored cadence unchanged. */
export function jobCadenceUpdate(
  patch: Pick<JobPatch, "cadence" | "everyMinutes">,
): ScheduledJob["cadence"] | undefined {
  if (patch.cadence !== undefined) return parseJobCadence(patch.cadence);
  if (patch.everyMinutes !== undefined) return null;
  return undefined;
}

export function applyJobPatch(job: ScheduledJob, patch: JobPatch, stamp = nowIso()): ScheduledJob {
  const cadence = jobCadenceUpdate(patch);
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as JobPatch;
  return {
    ...job,
    ...defined,
    ...(cadence !== undefined ? { cadence } : {}),
    updatedAt: stamp,
  };
}

export function isJobDue(job: Pick<ScheduledJob, "enabled" | "nextRunAt">, now: string): boolean {
  return job.enabled && job.nextRunAt <= now;
}

export function isJobLeaseFree(
  job: Pick<ScheduledJob, "leaseUntil">,
  now: string,
): boolean {
  return !job.leaseUntil || job.leaseUntil <= now;
}

export function isJobClaimable(
  job: Pick<ScheduledJob, "enabled" | "nextRunAt" | "leaseUntil">,
  now: string,
): boolean {
  return isJobDue(job, now) && isJobLeaseFree(job, now);
}

export function isManualJobClaimable(
  job: Pick<ScheduledJob, "enabled" | "leaseUntil">,
  now: string,
): boolean {
  return job.enabled && isJobLeaseFree(job, now);
}

export function applyJobLease(
  job: ScheduledJob,
  token: string,
  leaseUntil: string,
  stamp = nowIso(),
): ScheduledJob {
  return { ...job, leaseToken: token, leaseUntil, updatedAt: stamp };
}

/** Complete/release only if this worker still holds the claim token. */
export function holdsJobLease(
  stored: Pick<ScheduledJob, "leaseToken">,
  claimed: Pick<ScheduledJob, "leaseToken">,
): boolean {
  return Boolean(claimed.leaseToken) && stored.leaseToken === claimed.leaseToken;
}

export function completeJobMutation(job: ScheduledJob):
  | { action: "delete" }
  | {
      action: "advance";
      enabled: boolean;
      nextRunAt: string | null;
      leaseToken: null;
      leaseUntil: null;
      lastError: null;
    } {
  if (isOneOffJob(job)) return { action: "delete" };
  const advanced = advanceJobAfterRun(job);
  return {
    action: "advance",
    enabled: advanced.enabled,
    nextRunAt: advanced.nextRunAt ?? null,
    leaseToken: null,
    leaseUntil: null,
    lastError: null,
  };
}

export function releasedJobFields(
  error: string,
  retryAt: string | null,
  stamp = nowIso(),
  disable = false,
) {
  return {
    leaseToken: null,
    leaseUntil: null,
    lastError: error,
    ...(retryAt ? { nextRunAt: retryAt } : {}),
    ...(disable ? { enabled: false } : {}),
    updatedAt: stamp,
  };
}

export function sameEmbeddingKey(
  row: Pick<EmbeddingRecord, "userId" | "kind" | "sourceId" | "turnId">,
  input: Pick<EmbeddingRecord, "userId" | "kind" | "sourceId"> & {
    turnId?: string | null;
  },
): boolean {
  return (
    row.userId === input.userId &&
    row.kind === input.kind &&
    row.sourceId === input.sourceId &&
    (row.turnId ?? null) === (input.turnId ?? null)
  );
}

export function newEmbeddingRecord(
  input: CreateEmbeddingInput,
  stamp = nowIso(),
): EmbeddingRecord {
  return {
    id: input.id ?? randomUUID(),
    userId: input.userId,
    kind: input.kind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    turnId: input.turnId ?? null,
    text: input.text,
    embedding: input.embedding,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

export function applyEmbeddingUpdate(
  current: EmbeddingRecord,
  input: CreateEmbeddingInput,
  stamp = nowIso(),
): EmbeddingRecord {
  return {
    ...current,
    text: input.text,
    embedding: input.embedding,
    sourceType: input.sourceType,
    updatedAt: stamp,
  };
}

export function embeddingSearchQueries(input: EmbeddingSearchInput): number[][] {
  return input.queryEmbeddings.filter((query) => query.length > 0);
}

export function shouldSkipEmbeddingSearch(input: EmbeddingSearchInput): boolean {
  return embeddingSearchQueries(input).length === 0 || input.limit <= 0;
}

export function embeddingMatchesSearch(
  row: Pick<EmbeddingRecord, "userId" | "kind" | "sourceId">,
  input: EmbeddingSearchInput,
): boolean {
  if (input.kinds && !input.kinds.includes(row.kind as EmbeddingKind)) return false;
  if (input.excludeSourceIds?.includes(row.sourceId)) return false;
  if (input.scope === "account") return true;
  if (row.userId === input.userId) return true;
  return Boolean(input.includeSourceIds?.includes(row.sourceId));
}

export function rankEmbeddingHits(
  hits: readonly EmbeddingSearchHit[],
  input: Pick<EmbeddingSearchInput, "minScore" | "limit">,
): EmbeddingSearchHit[] {
  const byId = new Map<string, EmbeddingSearchHit>();
  for (const hit of hits) {
    const existing = byId.get(hit.record.id);
    if (!existing || hit.score > existing.score) byId.set(hit.record.id, hit);
  }
  return [...byId.values()]
    .filter((hit) => input.minScore == null || hit.score >= input.minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit);
}

export function scoreEmbeddingRecords(
  records: readonly EmbeddingRecord[],
  input: EmbeddingSearchInput,
): EmbeddingSearchHit[] {
  const queries = embeddingSearchQueries(input);
  if (shouldSkipEmbeddingSearch(input)) return [];
  return rankEmbeddingHits(
    records
      .filter((record) => embeddingMatchesSearch(record, input))
      .map((record) => ({
        record,
        score: Math.max(...queries.map((query) => cosineSimilarity(query, record.embedding))),
      })),
    input,
  );
}

export function sameCitationKey(
  row: Pick<SessionCitationSet, "userId" | "chatId" | "queryText">,
  input: UpsertCitationInput,
): boolean {
  return row.userId === input.userId && row.chatId === input.chatId && row.queryText === input.queryText;
}

export function newCitationSet(
  input: UpsertCitationInput,
  stamp = nowIso(),
  id: string = randomUUID(),
): SessionCitationSet {
  return {
    id,
    userId: input.userId,
    chatId: input.chatId,
    queryText: input.queryText,
    citations: input.citations,
    createdAt: stamp,
  };
}

export function applyCitationUpdate(
  current: SessionCitationSet,
  citations: SessionCitationSet["citations"],
): SessionCitationSet {
  return { ...current, citations };
}

export function mergedUsageRecord(existing: UsageRecord | undefined, record: UsageRecord): UsageRecord {
  if (!existing) return record;
  return { ...record, createdAt: existing.createdAt };
}

export function normalizeEmail(email: EmailRecord): EmailRecord {
  return {
    ...email,
    toAddresses: email.toAddresses ?? [],
    ccAddresses: email.ccAddresses ?? [],
    attachments: email.attachments ?? [],
    bodyText: email.bodyText ?? "",
    bodyHtml: email.bodyHtml ?? "",
  };
}

export function newEmailRecord(input: CreateEmailInput, stamp = nowIso()): EmailRecord {
  return normalizeEmail({
    ...input,
    id: input.id ?? randomUUID(),
    toAddresses: input.toAddresses ?? [],
    ccAddresses: input.ccAddresses ?? [],
    attachments: input.attachments ?? [],
    createdAt: stamp,
    updatedAt: stamp,
  });
}

export function applyEmailPatch(email: EmailRecord, patch: EmailPatch, stamp = nowIso()): EmailRecord {
  return normalizeEmail({ ...email, ...patch, updatedAt: stamp });
}
