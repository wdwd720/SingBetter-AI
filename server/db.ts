import "dotenv/config";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzleSqlite } from "drizzle-orm/sql-js";
import pg from "pg";
import initSqlJs from "sql.js";
import * as schema from "@shared/schema";

const { Pool } = pg;
const startupLogPath = process.env.STARTUP_LOG_PATH;

const logStartupIssue = (message: string, error?: unknown) => {
  const formattedError = error instanceof Error ? error.stack || error.message : String(error ?? "");
  const line = `[${new Date().toISOString()}] ${message}${formattedError ? ` | ${formattedError}` : ""}\n`;
  console.error(message, error ?? "");

  if (!startupLogPath) return;
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, line, "utf8");
  } catch {
    // Never crash startup if logging fails.
  }
};

const databaseUrl = process.env.DATABASE_URL;
const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.DISABLE_AUTH?.toLowerCase() === "true";

const isSqlite =
  !!databaseUrl &&
  (databaseUrl.startsWith("file:") || databaseUrl.startsWith("sqlite:"));
const databaseDialect = isSqlite ? "sqlite" : databaseUrl ? "postgres" : "none";

if (!databaseUrl && !isDev) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool =
  databaseUrl && !isSqlite ? new Pool({ connectionString: databaseUrl }) : undefined;

let sqliteDbFilePath: string | undefined;
let sqliteDb: import("sql.js").Database | undefined;

if (isSqlite && databaseUrl) {
  const filePath = databaseUrl.replace(/^sqlite:/, "").replace(/^file:/, "");
  if (filePath && filePath !== ":memory:") {
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    sqliteDbFilePath = resolvedPath;
  }

  const require = createRequire(import.meta.url);
  const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  let existingData: Buffer | undefined;
  if (sqliteDbFilePath && fs.existsSync(sqliteDbFilePath)) {
    try {
      const data = fs.readFileSync(sqliteDbFilePath);
      if (data.length > 0) {
        existingData = data;
      }
    } catch (error) {
      logStartupIssue("Failed to read existing SQLite file; starting fresh in memory", error);
    }
  }

  try {
    sqliteDb = existingData ? new SQL.Database(existingData) : new SQL.Database();
  } catch (error) {
    logStartupIssue("Failed to open SQLite file; creating fresh database in memory", error);
    sqliteDb = new SQL.Database();
  }

  sqliteDb.exec("PRAGMA foreign_keys = ON;");

  // Initialize schema for local SQLite dev if tables are missing.
  const initSql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      profile_image_url TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire);

    CREATE TABLE IF NOT EXISTS local_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS local_credentials_user_id_idx ON local_credentials(user_id);
    CREATE INDEX IF NOT EXISTS local_credentials_email_idx ON local_credentials(email);

    CREATE TABLE IF NOT EXISTS singing_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      goal TEXT NOT NULL,
      difficulty TEXT DEFAULT 'beginner',
      started_at INTEGER DEFAULT (strftime('%s','now')),
      ended_at INTEGER,
      duration_sec INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      overall_score INTEGER DEFAULT 0,
      pitch_score INTEGER DEFAULT 0,
      rhythm_score INTEGER DEFAULT 0,
      stability_score INTEGER DEFAULT 0,
      breath_score INTEGER DEFAULT 0,
      avg_cents_off REAL DEFAULT 0,
      in_tune_percent REAL DEFAULT 0,
      stability_std REAL DEFAULT 0,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      severity INTEGER DEFAULT 1,
      details TEXT
    );

    CREATE TABLE IF NOT EXISTS audio_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      public_url TEXT,
      mime_type TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS live_coaching_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      public_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_uploads_user ON live_coaching_uploads(user_id);
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_uploads_created ON live_coaching_uploads(created_at);

    CREATE TABLE IF NOT EXISTS live_coaching_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      public_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      duration_sec REAL DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_recordings_user ON live_coaching_recordings(user_id);
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_recordings_created ON live_coaching_recordings(created_at);

    CREATE TABLE IF NOT EXISTS live_coaching_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      upload_id INTEGER NOT NULL,
      recording_id INTEGER,
      verse_index INTEGER DEFAULT 0,
      verse_count INTEGER DEFAULT 1,
      score_overall INTEGER DEFAULT 0,
      score_pitch INTEGER DEFAULT 0,
      score_timing INTEGER DEFAULT 0,
      score_stability INTEGER DEFAULT 0,
      score_words INTEGER DEFAULT 0,
      score_label TEXT DEFAULT 'Performance',
      tips TEXT,
      focus_line TEXT,
      focus_areas TEXT,
      practice_mode TEXT DEFAULT 'full',
      debug TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_attempts_user ON live_coaching_attempts(user_id);
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_attempts_created ON live_coaching_attempts(created_at);
    CREATE INDEX IF NOT EXISTS IDX_live_coaching_attempts_upload ON live_coaching_attempts(upload_id);

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      locale TEXT NOT NULL DEFAULT 'en',
      consent_version TEXT,
      consent_given_at INTEGER,
      onboarding_completed_at INTEGER,
      email_notifications INTEGER NOT NULL DEFAULT 1,
      in_app_notifications INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_user_settings_user_id ON user_settings(user_id);
    CREATE INDEX IF NOT EXISTS IDX_user_settings_role ON user_settings(role);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_password_reset_tokens_user ON password_reset_tokens(user_id);
    CREATE INDEX IF NOT EXISTS IDX_password_reset_tokens_expires ON password_reset_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS user_mfa_factors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      secret TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      recovery_codes TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_user_mfa_factors_user_id ON user_mfa_factors(user_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      details TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_audit_logs_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS IDX_audit_logs_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS IDX_audit_logs_created ON audit_logs(created_at);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      name TEXT NOT NULL,
      properties TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_analytics_events_user ON analytics_events(user_id);
    CREATE INDEX IF NOT EXISTS IDX_analytics_events_name ON analytics_events(name);

    CREATE TABLE IF NOT EXISTS feedback_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      category TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_feedback_reports_user ON feedback_reports(user_id);
    CREATE INDEX IF NOT EXISTS IDX_feedback_reports_status ON feedback_reports(status);

    CREATE TABLE IF NOT EXISTS notification_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      read_at INTEGER,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_notification_items_user ON notification_items(user_id);
    CREATE INDEX IF NOT EXISTS IDX_notification_items_read ON notification_items(read_at);
    CREATE INDEX IF NOT EXISTS IDX_notification_items_created ON notification_items(created_at);

    CREATE TABLE IF NOT EXISTS privacy_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      request_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      payload TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS IDX_privacy_requests_user ON privacy_requests(user_id);
    CREATE INDEX IF NOT EXISTS IDX_privacy_requests_type ON privacy_requests(request_type);
    CREATE INDEX IF NOT EXISTS IDX_privacy_requests_status ON privacy_requests(status);
  `;
  sqliteDb.exec(initSql);
}

export const db =
  !databaseUrl
    ? null
    : isSqlite
      ? drizzleSqlite(sqliteDb!, { schema })
      : drizzlePg(pool!, { schema });

export const getDatabaseStatus = async (): Promise<{
  enabled: boolean;
  dialect: "sqlite" | "postgres" | "none";
  healthy: boolean;
  message?: string;
}> => {
  if (!databaseUrl || !db) {
    return {
      enabled: false,
      dialect: "none",
      healthy: false,
      message: "DATABASE_URL is not configured",
    };
  }

  if (databaseDialect === "sqlite") {
    return {
      enabled: true,
      dialect: "sqlite",
      healthy: true,
      message: sqliteDbFilePath ? `file:${sqliteDbFilePath}` : "sqlite::memory:",
    };
  }

  if (!pool) {
    return {
      enabled: true,
      dialect: "postgres",
      healthy: false,
      message: "Postgres pool is not initialized",
    };
  }

  try {
    await pool.query("select 1");
    return {
      enabled: true,
      dialect: "postgres",
      healthy: true,
    };
  } catch (error) {
    return {
      enabled: true,
      dialect: "postgres",
      healthy: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

if (isSqlite && sqliteDbFilePath) {
  let saved = false;
  const persist = () => {
    if (saved) return;
    try {
      const data = sqliteDb!.export();
      fs.writeFileSync(sqliteDbFilePath!, Buffer.from(data));
      saved = true;
    } catch (error) {
      logStartupIssue("Failed to persist SQLite database to disk", error);
    }
  };

  process.on("exit", persist);
  process.on("beforeExit", persist);
  process.on("SIGINT", () => {
    persist();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    persist();
    process.exit(0);
  });
}
