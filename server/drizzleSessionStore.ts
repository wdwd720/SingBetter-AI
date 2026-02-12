import session from "express-session";
import { eq, lt } from "drizzle-orm";
import { sessions } from "@shared/models/auth";
import { db } from "./db";

const defaultTtlMs = 7 * 24 * 60 * 60 * 1000;

const getDbOrThrow = () => {
  if (!db) {
    throw new Error("DATABASE_URL must be set for DB-backed sessions");
  }
  return db as any;
};

const toDate = (value: unknown): Date => {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  if (typeof value === "string") return new Date(value);
  return new Date();
};

const getExpiration = (
  sess: session.SessionData,
  ttlMs: number,
): Date => {
  const expires = sess.cookie?.expires;
  if (expires instanceof Date) {
    return expires;
  }
  if (typeof expires === "string" || typeof expires === "number") {
    const parsed = new Date(expires);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(Date.now() + ttlMs);
};

const cloneSession = (sess: session.SessionData): session.SessionData =>
  JSON.parse(JSON.stringify(sess));

export class DrizzleSessionStore extends session.Store {
  private readonly ttlMs: number;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(ttlMs = defaultTtlMs) {
    super();
    this.ttlMs = ttlMs;
    this.cleanupTimer = setInterval(() => {
      void this.pruneExpired();
    }, 30 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  private async pruneExpired(): Promise<void> {
    const dbAny = getDbOrThrow();
    await dbAny
      .delete(sessions as any)
      .where(lt(sessions.expire as any, new Date()));
  }

  get(
    sid: string,
    callback: (err?: unknown, sessionData?: session.SessionData | null) => void,
  ): void {
    void (async () => {
      const dbAny = getDbOrThrow();
      const row = await dbAny.query.sessions.findFirst({
        where: eq(sessions.sid, sid),
      });

      if (!row) {
        callback(undefined, null);
        return;
      }

      const expireAt = toDate(row.expire);
      if (expireAt.getTime() <= Date.now()) {
        await dbAny.delete(sessions as any).where(eq(sessions.sid, sid));
        callback(undefined, null);
        return;
      }

      const rawSession = row.sess;
      let sessionData: session.SessionData | null = null;

      if (rawSession && typeof rawSession === "object") {
        sessionData = rawSession as session.SessionData;
      } else if (typeof rawSession === "string") {
        try {
          sessionData = JSON.parse(rawSession) as session.SessionData;
        } catch {
          sessionData = null;
        }
      }

      if (!sessionData || typeof sessionData !== "object") {
        await dbAny.delete(sessions as any).where(eq(sessions.sid, sid));
        callback(undefined, null);
        return;
      }

      if (!(sessionData as any).cookie || typeof (sessionData as any).cookie !== "object") {
        (sessionData as any).cookie = {
          path: "/",
          httpOnly: true,
          originalMaxAge: this.ttlMs,
          expires: new Date(Date.now() + this.ttlMs),
        };
      }

      callback(undefined, sessionData);
    })().catch((err) => callback(err));
  }

  set(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    void (async () => {
      const dbAny = getDbOrThrow();
      const expire = getExpiration(sess, this.ttlMs);
      const serialized = cloneSession(sess);
      await dbAny
        .insert(sessions as any)
        .values({
          sid,
          sess: serialized,
          expire,
        })
        .onConflictDoUpdate({
          target: sessions.sid,
          set: {
            sess: serialized,
            expire,
          },
        });
      callback?.();
    })().catch((err) => callback?.(err));
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    void (async () => {
      const dbAny = getDbOrThrow();
      await dbAny.delete(sessions as any).where(eq(sessions.sid, sid));
      callback?.();
    })().catch((err) => callback?.(err));
  }

  touch(
    sid: string,
    sess: session.SessionData,
    callback?: (err?: unknown) => void,
  ): void {
    void (async () => {
      const dbAny = getDbOrThrow();
      const expire = getExpiration(sess, this.ttlMs);
      await dbAny
        .update(sessions as any)
        .set({ expire })
        .where(eq(sessions.sid, sid));
      callback?.();
    })().catch((err) => callback?.(err));
  }
}
