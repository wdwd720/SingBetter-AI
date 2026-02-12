import * as pgAuth from "./auth.pg";
import * as sqliteAuth from "./auth.sqlite";

function detectSqlite(): boolean {
  if (typeof process === "undefined" || !process.env) {
    return false;
  }
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("file:") || url.startsWith("sqlite:");
}

const useSqlite = detectSqlite();

export const sessions = useSqlite ? sqliteAuth.sessions : pgAuth.sessions;
export const users = useSqlite ? sqliteAuth.users : pgAuth.users;

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
