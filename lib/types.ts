import type { JobCadence } from "@/lib/job-cadence";
import type { ResourceVisibility } from "@/lib/visibility";

export type { ResourceVisibility };

export type ModelTier = "auto" | "low" | "high";

export type ChatSource = "web" | "email" | "text" | "schedule";

export const chatSourceLabels: Record<ChatSource, string> = {
  web: "Web",
  email: "Email",
  text: "Text",
  schedule: "Schedule",
};

export function normalizeChatSource(value: unknown): ChatSource {
  if (value === "email" || value === "text" || value === "web" || value === "schedule") return value;
  return "web";
}

export type ChatRecord = {
  id: string;
  userId: string;
  title: string;
  description: string;
  source: ChatSource;
  sessionId: string | null;
  streamIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type ChatPatch = Partial<
  Pick<ChatRecord, "title" | "description" | "sessionId" | "streamIndex">
> & {
  touchUpdatedAt?: boolean;
};

export type ChatEventRecord = {
  id: string;
  chatId: string;
  index: number;
  event: unknown;
};

export type UserSettings = {
  userId: string;
  modelTier: ModelTier;
  instructionOverlay: string;
  inboundMailToken: string | null;
};

export type ProfileMemory = {
  index: number;
  text: string;
};

export type UserSkill = {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string;
  markdown: string;
  enabled: boolean;
  visibility: ResourceVisibility;
  createdAt: string;
  updatedAt: string;
};

export type ScheduledJob = {
  id: string;
  userId: string;
  prompt: string;
  firstRunAt: string;
  nextRunAt: string;
  everyMinutes: number | null;
  cadence: JobCadence | null;
  enabled: boolean;
  leaseToken: string | null;
  leaseUntil: string | null;
  lastError: string | null;
  authenticator: string;
  issuer: string | null;
  visibility: ResourceVisibility;
  createdAt: string;
  updatedAt: string;
};

export type DocumentKind =
  | "markdown"
  | "html"
  | "text"
  | "csv"
  | "json"
  | "image"
  | "pdf"
  | "other";

export type DocumentRecord = {
  id: string;
  userId: string;
  folderId: string | null;
  title: string;
  filename: string;
  kind: DocumentKind;
  mimeType: string;
  blobPathname: string;
  blobUrl: string;
  size: number;
  isPublic: boolean;
  shareId: string;
  visibility: ResourceVisibility;
  createdAt: string;
  updatedAt: string;
};

export type DocumentFolder = {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  description: string;
  visibility: ResourceVisibility;
  createdAt: string;
  updatedAt: string;
};

export type DocumentSessionLink = {
  documentId: string;
  chatId: string;
  createdAt: string;
};

export type ClientDocument = Omit<DocumentRecord, "blobPathname" | "blobUrl"> & {
  href: string;
  fileHref: string;
  shareUrl: string | null;
  editable: boolean;
  canEdit: boolean;
  folderPath: string;
  owned: boolean;
};

export type ClientFolder = Omit<DocumentFolder, "userId"> & {
  href: string;
  path: string;
  fileCount: number;
  owned: boolean;
};

export type DocumentSearchMatch = "name" | "content" | "similar";

export type DocumentSearchHit = {
  type: "document" | "folder";
  score: number;
  match: DocumentSearchMatch;
  document?: ClientDocument;
  folder?: ClientFolder;
};

export type EmailDirection = "inbound" | "outbound";

export type EmailStatus = "received" | "sent" | "failed" | "processed";

export type EmailAttachmentMeta = {
  filename: string;
  contentType: string;
  size?: number | null;
};

export type EmailRecord = {
  id: string;
  userId: string;
  direction: EmailDirection;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  resendEmailId: string | null;
  status: EmailStatus;
  hasActionItem: boolean;
  actionSummary: string | null;
  chatId: string | null;
  inReplyTo: string | null;
  attachments: EmailAttachmentMeta[];
  createdAt: string;
  updatedAt: string;
};

export type EmailSearchHit = {
  email: EmailRecord;
  score: number;
  match: "subject" | "body" | "similar";
};

export type EmbeddingSourceType = "session" | "document" | "folder" | "skill" | "email";

export type EmbeddingKind =
  | "session_prompt"
  | "session_response"
  | "session_title"
  | "session_description"
  | "document_title"
  | "document_content"
  | "folder_name"
  | "folder_description"
  | "skill_description"
  | "skill_content"
  | "email_subject"
  | "email_body";

export type EmbeddingRecord = {
  id: string;
  userId: string;
  kind: EmbeddingKind;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  turnId: string | null;
  text: string;
  embedding: number[];
  createdAt: string;
  updatedAt: string;
};

export type EmbeddingSearchInput = {
  userId: string;
  queryEmbeddings: readonly number[][];
  kinds?: readonly EmbeddingKind[];
  excludeSourceIds?: readonly string[];
  /**
   * Also include embeddings whose `sourceId` is in this list, even when they
   * belong to another user (shared/public library rows). Ignored when `scope`
   * is `"account"`.
   */
  includeSourceIds?: readonly string[];
  limit: number;
  minScore?: number;
  /**
   * `account` searches every user's embeddings; the caller must drop private
   * hits. Library and inbox search should use user scope plus `includeSourceIds`.
   */
  scope?: "user" | "account";
};

export type EmbeddingSearchHit = {
  record: EmbeddingRecord;
  score: number;
};

export type SessionCitation = {
  index: number;
  chatId: string;
  title: string;
  description: string;
  href: string;
};

export type SessionCitationSet = {
  id: string;
  userId: string;
  chatId: string;
  queryText: string;
  citations: SessionCitation[];
  createdAt: string;
};

export const USAGE_PURPOSES = [
  "chat",
  "compaction",
  "routing",
  "session_title",
  "session_memory",
  "embeddings",
  "instructions",
  "transcription",
  "speech",
  "image",
  "web_search",
  "email",
] as const;

export type UsagePurpose = (typeof USAGE_PURPOSES)[number];

export type UsageRecord = {
  id: string;
  userId: string;
  chatId: string | null;
  purpose: UsagePurpose;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  createdAt: string;
};
