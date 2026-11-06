import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  boolean,
  doublePrecision,
  index,
  integer as pgInteger,
  jsonb,
  pgTable,
  text as pgText,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { JobCadence } from "@/lib/job-cadence";

export const sqliteUser = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sqliteSession = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => sqliteUser.id, { onDelete: "cascade" }),
});

export const sqliteAccount = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer").notNull().default(""),
  userId: text("user_id")
    .notNull()
    .references(() => sqliteUser.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const sqliteVerification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

export const pgUser = pgTable("user", {
  id: pgText("id").primaryKey(),
  name: pgText("name").notNull(),
  email: pgText("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: pgText("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const pgSession = pgTable("session", {
  id: pgText("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: pgText("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: pgText("ip_address"),
  userAgent: pgText("user_agent"),
  userId: pgText("user_id")
    .notNull()
    .references(() => pgUser.id, { onDelete: "cascade" }),
});

export const pgAccount = pgTable("account", {
  id: pgText("id").primaryKey(),
  accountId: pgText("account_id").notNull(),
  providerId: pgText("provider_id").notNull(),
  issuer: pgText("issuer").notNull().default(""),
  userId: pgText("user_id")
    .notNull()
    .references(() => pgUser.id, { onDelete: "cascade" }),
  accessToken: pgText("access_token"),
  refreshToken: pgText("refresh_token"),
  idToken: pgText("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: pgText("scope"),
  password: pgText("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const pgVerification = pgTable("verification", {
  id: pgText("id").primaryKey(),
  identifier: pgText("identifier").notNull(),
  value: pgText("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

export const pgChats = pgTable(
  "chats",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull(),
    title: pgText("title").notNull(),
    description: pgText("description").notNull().default(""),
    source: pgText("source").notNull().default("web"),
    sessionId: pgText("session_id"),
    streamIndex: pgInteger("stream_index").notNull().default(0),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("chats_session_id_idx").on(table.sessionId)],
);

export const pgChatEvents = pgTable("chat_events", {
  id: pgText("id").primaryKey(),
  chatId: pgText("chat_id").notNull(),
  index: pgInteger("index").notNull(),
  event: jsonb("event").notNull(),
});

export const pgUserSettings = pgTable("user_settings", {
  userId: pgText("user_id").primaryKey(),
  modelTier: pgText("model_tier").notNull().default("auto"),
  instructionOverlay: pgText("instruction_overlay").notNull().default(""),
});

// Session-generated records (intake briefs, quotes, plans, decisions) live as
// files and sticky-note memory. Add a pgTable here — plus store helpers and a
// tool — only when a fork needs a rigid schema for a custom domain object.

export const pgUserSkills = pgTable("user_skills", {
  id: pgText("id").primaryKey(),
  userId: pgText("user_id").notNull(),
  name: pgText("name").notNull().default(""),
  slug: pgText("slug").notNull(),
  description: pgText("description").notNull(),
  markdown: pgText("markdown").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  visibility: pgText("visibility").notNull().default("account"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const pgDocumentFolders = pgTable(
  "document_folders",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull(),
    parentId: pgText("parent_id"),
    name: pgText("name").notNull(),
    description: pgText("description").notNull().default(""),
    visibility: pgText("visibility").notNull().default("private"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("document_folders_parent_idx").on(table.userId, table.parentId)],
);

export const pgDocuments = pgTable(
  "documents",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull(),
    folderId: pgText("folder_id"),
    title: pgText("title").notNull(),
    filename: pgText("filename").notNull(),
    kind: pgText("kind").notNull(),
    mimeType: pgText("mime_type").notNull(),
    blobPathname: pgText("blob_pathname").notNull(),
    blobUrl: pgText("blob_url").notNull(),
    size: pgInteger("size").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    shareId: pgText("share_id").notNull().unique(),
    visibility: pgText("visibility").notNull().default("private"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("documents_folder_id_idx").on(table.userId, table.folderId)],
);

export const pgDocumentSessions = pgTable("document_sessions", {
  documentId: pgText("document_id").notNull(),
  chatId: pgText("chat_id").notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const pgEmbeddings = pgTable(
  "embeddings",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull(),
    kind: pgText("kind").notNull(),
    sourceType: pgText("source_type").notNull(),
    sourceId: pgText("source_id").notNull(),
    turnId: pgText("turn_id"),
    text: pgText("text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("embeddings_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const pgSessionCitations = pgTable("session_citations", {
  id: pgText("id").primaryKey(),
  userId: pgText("user_id").notNull(),
  chatId: pgText("chat_id").notNull(),
  queryText: pgText("query_text").notNull(),
  citations: jsonb("citations").notNull().$type<
    {
      index: number;
      chatId: string;
      title: string;
      description: string;
      href: string;
    }[]
  >(),
  createdAt: timestamp("created_at").notNull(),
});

export const pgUsageEvents = pgTable(
  "usage_events",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull(),
    chatId: pgText("chat_id"),
    purpose: pgText("purpose").notNull(),
    modelId: pgText("model_id").notNull(),
    inputTokens: pgInteger("input_tokens").notNull().default(0),
    outputTokens: pgInteger("output_tokens").notNull().default(0),
    reasoningTokens: pgInteger("reasoning_tokens").notNull().default(0),
    cacheReadTokens: pgInteger("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: pgInteger("cache_write_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("usage_events_user_id_idx").on(table.userId),
    index("usage_events_chat_id_idx").on(table.chatId),
  ],
);

export const pgEmails = pgTable(
  "emails",
  {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull(),
    direction: pgText("direction").notNull(),
    fromAddress: pgText("from_address").notNull(),
    toAddresses: jsonb("to_addresses").notNull().$type<string[]>(),
    ccAddresses: jsonb("cc_addresses").notNull().$type<string[]>(),
    subject: pgText("subject").notNull(),
    bodyText: pgText("body_text").notNull().default(""),
    bodyHtml: pgText("body_html").notNull().default(""),
    resendEmailId: pgText("resend_email_id"),
    status: pgText("status").notNull(),
    hasActionItem: boolean("has_action_item").notNull().default(false),
    actionSummary: pgText("action_summary"),
    chatId: pgText("chat_id"),
    inReplyTo: pgText("in_reply_to"),
    messageId: pgText("message_id"),
    attachments: jsonb("attachments").notNull().$type<
      { filename: string; contentType: string; size?: number | null }[]
    >(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("emails_user_id_idx").on(table.userId),
    index("emails_resend_id_idx").on(table.resendEmailId),
    index("emails_message_id_idx").on(table.messageId),
    uniqueIndex("emails_resend_id_unique_idx")
      .on(table.resendEmailId)
      .where(sql`${table.resendEmailId} IS NOT NULL`),
  ],
);

export const pgScheduledJobs = pgTable("scheduled_jobs", {
  id: pgText("id").primaryKey(),
  userId: pgText("user_id").notNull(),
  prompt: pgText("prompt").notNull(),
  firstRunAt: timestamp("first_run_at").notNull(),
  nextRunAt: timestamp("next_run_at").notNull(),
  everyMinutes: pgInteger("every_minutes"),
  cadence: jsonb("cadence").$type<JobCadence | null>(),
  enabled: boolean("enabled").notNull().default(true),
  leaseToken: pgText("lease_token"),
  leaseUntil: timestamp("lease_until"),
  lastError: pgText("last_error"),
  authenticator: pgText("authenticator").notNull(),
  issuer: pgText("issuer"),
  visibility: pgText("visibility").notNull().default("account"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const sqliteAuthSchema = {
  user: sqliteUser,
  session: sqliteSession,
  account: sqliteAccount,
  verification: sqliteVerification,
};

export const pgAuthSchema = {
  user: pgUser,
  session: pgSession,
  account: pgAccount,
  verification: pgVerification,
};
