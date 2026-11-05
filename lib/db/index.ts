import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const require = createRequire(import.meta.url);

export function hasNeon(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let sqliteDb: import("drizzle-orm/better-sqlite3").BetterSQLite3Database<{
  user: typeof schema.sqliteUser;
  session: typeof schema.sqliteSession;
  account: typeof schema.sqliteAccount;
  verification: typeof schema.sqliteVerification;
}> | null = null;
let neonDb: ReturnType<typeof drizzleNeon> | null = null;

export function getSqliteDb() {
  if (!sqliteDb) {
    const { drizzle: drizzleSqlite } = require("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
    const file = path.join(process.cwd(), ".data", "local.db");
    mkdirSync(path.dirname(file), { recursive: true });
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const client = new Database(file);
    client.pragma("journal_mode = WAL");
    client.exec(`
      CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL,
        image TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        user_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        issuer TEXT NOT NULL DEFAULT '',
        user_id TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        id_token TEXT,
        access_token_expires_at INTEGER,
        refresh_token_expires_at INTEGER,
        scope TEXT,
        password TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS verification (
        id TEXT PRIMARY KEY,
        identifier TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    const accountColumns = client
      .prepare("PRAGMA table_info(account)")
      .all() as Array<{ name: string }>;
    if (!accountColumns.some((column) => column.name === "issuer")) {
      client.exec("ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT ''");
    }
    sqliteDb = drizzleSqlite(client, {
      schema: {
        user: schema.sqliteUser,
        session: schema.sqliteSession,
        account: schema.sqliteAccount,
        verification: schema.sqliteVerification,
      },
    });
  }
  return sqliteDb;
}

export function getNeonDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!neonDb) {
    neonDb = drizzleNeon(neon(databaseUrl), { schema });
  }
  return neonDb;
}

let neonAuthSchema: Promise<void> | undefined;

export async function ensureNeonAuthSchema() {
  if (!hasNeon()) {
    return;
  }
  neonAuthSchema ??= createNeonAuthTables().catch((error) => {
    neonAuthSchema = undefined;
    throw error;
  });
  await neonAuthSchema;
}

async function createNeonAuthTables() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return;
  }

  const sql = neon(databaseUrl);
  await sql`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified BOOLEAN NOT NULL,
      image TEXT,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "session" (
      id TEXT PRIMARY KEY,
      expires_at TIMESTAMP NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "account" (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      issuer TEXT NOT NULL DEFAULT '',
      user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at TIMESTAMP,
      refresh_token_expires_at TIMESTAMP,
      scope TEXT,
      password TEXT,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS "verification" (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    )
  `;

  const issuerColumn = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'account'
      AND column_name = 'issuer'
  `;
  if (issuerColumn.length === 0) {
    await sql`ALTER TABLE "account" ADD COLUMN issuer TEXT NOT NULL DEFAULT ''`;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'web',
      session_id TEXT,
      stream_index INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  const chatSourceColumn = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'source'
  `;
  if (chatSourceColumn.length === 0) {
    await sql`ALTER TABLE chats ADD COLUMN source TEXT NOT NULL DEFAULT 'web'`;
  }
  const chatDescriptionColumn = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'description'
  `;
  if (chatDescriptionColumn.length === 0) {
    await sql`ALTER TABLE chats ADD COLUMN description TEXT NOT NULL DEFAULT ''`;
  }
  await sql`CREATE INDEX IF NOT EXISTS chats_session_id_idx ON chats (session_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_events (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      "index" INTEGER NOT NULL,
      event JSONB NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      model_tier TEXT NOT NULL DEFAULT 'auto',
      instruction_overlay TEXT NOT NULL DEFAULT ''
    )
  `;
  await sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS inbound_mail_token TEXT`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS user_settings_inbound_mail_token_uidx
    ON user_settings (inbound_mail_token)
    WHERE inbound_mail_token IS NOT NULL
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      slug TEXT NOT NULL,
      description TEXT NOT NULL,
      markdown TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT true,
      visibility TEXT NOT NULL DEFAULT 'account',
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE user_skills ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'account'`;
  await sql`
    CREATE TABLE IF NOT EXISTS document_folders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`ALTER TABLE document_folders ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`;
  await sql`ALTER TABLE document_folders ALTER COLUMN visibility SET DEFAULT 'private'`;
  await sql`UPDATE document_folders SET visibility = 'private' WHERE visibility = 'account'`;
  await sql`
    CREATE INDEX IF NOT EXISTS document_folders_parent_idx
    ON document_folders (user_id, parent_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      folder_id TEXT,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      blob_pathname TEXT NOT NULL,
      blob_url TEXT NOT NULL,
      size INTEGER NOT NULL,
      is_public BOOLEAN NOT NULL DEFAULT false,
      share_id TEXT NOT NULL UNIQUE,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder_id TEXT`;
  await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`;
  await sql`ALTER TABLE documents ALTER COLUMN visibility SET DEFAULT 'private'`;
  await sql`UPDATE documents SET visibility = 'public' WHERE is_public = true`;
  await sql`UPDATE documents SET visibility = 'private' WHERE visibility = 'account' AND is_public = false`;
  await sql`
    CREATE INDEX IF NOT EXISTS documents_folder_id_idx
    ON documents (user_id, folder_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS document_sessions (
      document_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL,
      PRIMARY KEY (document_id, chat_id)
    )
  `;
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`
    CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      turn_id TEXT,
      text TEXT NOT NULL,
      embedding vector(1536) NOT NULL,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  const embeddingColumn = (await sql`
    SELECT udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'embeddings'
      AND column_name = 'embedding'
  `) as Array<{ udt_name?: string }>;
  if (embeddingColumn[0]?.udt_name && embeddingColumn[0].udt_name !== "vector") {
    await sql`
      ALTER TABLE embeddings
      ALTER COLUMN embedding TYPE vector(1536)
      USING (embedding::text)::vector
    `;
  }
  await sql`
    CREATE INDEX IF NOT EXISTS embeddings_user_id_idx ON embeddings (user_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS embeddings_source_idx ON embeddings (source_type, source_id)
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS embeddings_lookup_idx
    ON embeddings (user_id, kind, source_id, COALESCE(turn_id, ''))
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS embeddings_embedding_hnsw_idx
    ON embeddings USING hnsw (embedding vector_cosine_ops)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS session_citations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      query_text TEXT NOT NULL,
      citations JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS session_citations_lookup_idx
    ON session_citations (user_id, chat_id, query_text)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS session_citations_chat_id_idx
    ON session_citations (chat_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT,
      purpose TEXT NOT NULL,
      model_id TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS usage_events_user_id_idx ON usage_events (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS usage_events_chat_id_idx ON usage_events (chat_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_addresses JSONB NOT NULL,
      cc_addresses JSONB NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      resend_email_id TEXT,
      status TEXT NOT NULL,
      has_action_item BOOLEAN NOT NULL DEFAULT false,
      action_summary TEXT,
      chat_id TEXT,
      in_reply_to TEXT,
      attachments JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS emails_user_id_idx ON emails (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS emails_resend_id_idx ON emails (resend_email_id)`;
  try {
    // One row per Resend message, so a webhook retry cannot start a second session.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS emails_resend_id_unique_idx
      ON emails (resend_email_id) WHERE resend_email_id IS NOT NULL
    `;
  } catch (error) {
    console.warn("[db] emails_resend_id_unique_idx not created; remove duplicate rows first", error);
  }
  await sql`
    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      first_run_at TIMESTAMP NOT NULL,
      next_run_at TIMESTAMP NOT NULL,
      every_minutes INTEGER,
      cadence JSONB,
      enabled BOOLEAN NOT NULL DEFAULT true,
      lease_token TEXT,
      lease_until TIMESTAMP,
      last_error TEXT,
      authenticator TEXT NOT NULL,
      issuer TEXT,
      visibility TEXT NOT NULL DEFAULT 'account',
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    )
  `;
  await sql`ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'account'`;
  await sql`ALTER TABLE scheduled_jobs ADD COLUMN IF NOT EXISTS cadence JSONB`;
}
