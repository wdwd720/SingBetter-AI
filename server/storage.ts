import fs from "fs";
import path from "path";
import { db } from "./db";
import { 
  singingSessions, sessionMetrics, sessionEvents, audioArtifacts, liveCoachingAttempts,
  type Session, type InsertSession, 
  type SessionMetrics, type InsertSessionMetrics,
  type SessionEvent, type InsertSessionEvent,
  type AudioArtifact, type InsertAudioArtifact,
  type SessionWithMetrics
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { authStorage, type IAuthStorage } from "./replit_integrations/auth";
import { listRecentAttempts as listJsonRecentAttempts } from "./liveCoachingStore";

type JsonDb = {
  users: Array<{ id: string; email?: string | null; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null; createdAt?: string; updatedAt?: string }>;
  sessions: Session[];
  metrics: SessionMetrics[];
  events: SessionEvent[];
  artifacts: AudioArtifact[];
};

const jsonDbPath = path.join(process.cwd(), "server", "data", "local-db.json");

function loadJsonDb(): JsonDb {
  if (!fs.existsSync(jsonDbPath)) {
    return { users: [], sessions: [], metrics: [], events: [], artifacts: [] };
  }
  const raw = fs.readFileSync(jsonDbPath, "utf-8");
  const parsed = JSON.parse(raw) as JsonDb;
  return {
    users: parsed.users || [],
    sessions: parsed.sessions || [],
    metrics: parsed.metrics || [],
    events: parsed.events || [],
    artifacts: parsed.artifacts || [],
  };
}

function saveJsonDb(dbData: JsonDb) {
  fs.mkdirSync(path.dirname(jsonDbPath), { recursive: true });
  fs.writeFileSync(jsonDbPath, JSON.stringify(dbData, null, 2), "utf-8");
}

function nextId(items: Array<{ id: number }>): number {
  if (items.length === 0) return 1;
  return Math.max(...items.map((item) => item.id)) + 1;
}

function normalizeDate(input: Date | string | null | undefined): Date | null {
  if (!input) return null;
  return input instanceof Date ? input : new Date(input);
}

const progressCacheTtlMs = 30 * 1000;
const progressCache = new Map<string, { value: any; expiresAt: number }>();

const getCachedProgress = (userId: string) => {
  const cached = progressCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    progressCache.delete(userId);
    return null;
  }
  return cached.value;
};

const setCachedProgress = (userId: string, value: any) => {
  progressCache.set(userId, {
    value,
    expiresAt: Date.now() + progressCacheTtlMs,
  });
};

const clearProgressCache = () => {
  progressCache.clear();
};

export const invalidateProgressCache = () => {
  clearProgressCache();
};

export interface IStorage extends IAuthStorage {
  // Session operations
  createSession(session: InsertSession & { userId: string }): Promise<Session>;
  getSession(id: number): Promise<SessionWithMetrics | undefined>;
  getUserSessions(userId: string, limit?: number, offset?: number): Promise<SessionWithMetrics[]>;
  updateSession(id: number, updates: Partial<Session>): Promise<Session>;
  
  // Metrics & Events
  addSessionMetrics(metrics: InsertSessionMetrics): Promise<SessionMetrics>;
  addSessionEvents(events: InsertSessionEvent[]): Promise<void>;
  
  // Artifacts
  addAudioArtifact(artifact: InsertAudioArtifact): Promise<AudioArtifact>;
  
  // Analysis
  getUserProgress(userId: string): Promise<{
    totalSessions: number;
    totalDurationSec: number;
    averageScore: number;
    streakDays: number;
    recentScores: { date: string, score: number }[];
  }>;
}

export class DatabaseStorage implements IStorage {
  // Inherit auth methods
  getUser = authStorage.getUser;
  upsertUser = authStorage.upsertUser;

  async createSession(session: InsertSession & { userId: string }): Promise<Session> {
    const dbAny = db as any;
    const [newSession] = await dbAny.insert(singingSessions as any).values(session).returning();
    clearProgressCache();
    return newSession;
  }

  async getSession(id: number): Promise<SessionWithMetrics | undefined> {
    const dbAny = db as any;
    const session = await dbAny.query.singingSessions.findFirst({
      where: eq(singingSessions.id, id),
      with: {
        metrics: true,
        events: true,
      }
    });
    return session;
  }

  async getUserSessions(userId: string, limit = 20, offset = 0): Promise<SessionWithMetrics[]> {
    const dbAny = db as any;
    return await dbAny.query.singingSessions.findMany({
      where: eq(singingSessions.userId, userId),
      limit,
      offset,
      orderBy: desc(singingSessions.startedAt),
      with: {
        metrics: true,
      }
    });
  }

  async updateSession(id: number, updates: Partial<Session>): Promise<Session> {
    const dbAny = db as any;
    const [updated] = await dbAny
      .update(singingSessions as any)
      .set(updates)
      .where(eq(singingSessions.id, id))
      .returning();
    clearProgressCache();
    return updated;
  }

  async addSessionMetrics(metrics: InsertSessionMetrics): Promise<SessionMetrics> {
    const dbAny = db as any;
    const [newMetrics] = await dbAny.insert(sessionMetrics as any).values(metrics).returning();
    clearProgressCache();
    return newMetrics;
  }

  async addSessionEvents(events: InsertSessionEvent[]): Promise<void> {
    if (events.length === 0) return;
    const dbAny = db as any;
    await dbAny.insert(sessionEvents as any).values(events);
    clearProgressCache();
  }

  async addAudioArtifact(artifact: InsertAudioArtifact): Promise<AudioArtifact> {
    const dbAny = db as any;
    const [newArtifact] = await dbAny.insert(audioArtifacts as any).values(artifact).returning();
    clearProgressCache();
    return newArtifact;
  }

  async getUserProgress(userId: string) {
    const cached = getCachedProgress(userId);
    if (cached) return cached;

    const dbAny = db as any;
    const userSessions = await dbAny.select({
      id: singingSessions.id,
      duration: singingSessions.durationSec,
      startedAt: singingSessions.startedAt,
      score: sessionMetrics.overallScore,
    })
    .from(singingSessions)
    .leftJoin(sessionMetrics, eq(singingSessions.id, sessionMetrics.sessionId))
    .where(eq(singingSessions.userId, userId))
    .orderBy(desc(singingSessions.startedAt));

    const typedSessions = userSessions as Array<{
      id: number;
      duration: number | null;
      startedAt: Date | null;
      score: number | null;
    }>;

    const userAttempts = await dbAny
      .select({
        createdAt: liveCoachingAttempts.createdAt,
        score: liveCoachingAttempts.scoreOverall,
      })
      .from(liveCoachingAttempts)
      .where(eq(liveCoachingAttempts.userId, userId))
      .orderBy(desc(liveCoachingAttempts.createdAt));

    const typedAttempts = userAttempts as Array<{
      createdAt: Date | null;
      score: number | null;
    }>;

    const totalSessions = typedSessions.length + typedAttempts.length;
    const totalDurationSec = typedSessions.reduce(
      (acc: number, s) => acc + (s.duration || 0),
      0
    );
    
    const sessionScores = typedSessions
      .filter(s => s.score !== null)
      .map(s => s.score!);
    const attemptScores = typedAttempts
      .filter((attempt) => attempt.score !== null)
      .map((attempt) => attempt.score!);
    const scores = [...sessionScores, ...attemptScores];
    const averageScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const uniqueDays = new Set(
      [
        ...typedSessions.map((session) =>
          session.startedAt ? new Date(session.startedAt).toDateString() : ""
        ),
        ...typedAttempts.map((attempt) =>
          attempt.createdAt ? new Date(attempt.createdAt).toDateString() : ""
        ),
      ].filter(Boolean)
    );
    const streakDays = uniqueDays.size;

    const recentScores = [
      ...typedSessions
        .filter((session) => session.score !== null && session.startedAt)
        .map((session) => ({
          date: session.startedAt!.toISOString(),
          score: session.score!,
        })),
      ...typedAttempts
        .filter((attempt) => attempt.score !== null && attempt.createdAt)
        .map((attempt) => ({
          date: attempt.createdAt!.toISOString(),
          score: attempt.score!,
        })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)
      .reverse();

    const computed = {
      totalSessions,
      totalDurationSec,
      averageScore,
      streakDays,
      recentScores
    };
    setCachedProgress(userId, computed);
    return computed;
  }
}

class JsonStorage implements IStorage {
  getUser = async (id: string) => {
    const dbData = loadJsonDb();
    const user = dbData.users.find((entry) => entry.id === id);
    if (!user) return undefined;
    return {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
      createdAt: user.createdAt ? new Date(user.createdAt) : null,
      updatedAt: user.updatedAt ? new Date(user.updatedAt) : null,
    };
  };

  upsertUser = async (userData: any) => {
    const dbData = loadJsonDb();
    const existing = dbData.users.find((user) => user.id === userData.id);
    const now = new Date().toISOString();
    if (existing) {
      Object.assign(existing, userData, { updatedAt: now });
    } else {
      dbData.users.push({
        id: userData.id,
        email: userData.email ?? null,
        firstName: userData.firstName ?? null,
        lastName: userData.lastName ?? null,
        profileImageUrl: userData.profileImageUrl ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
    saveJsonDb(dbData);
    return {
      id: userData.id,
      email: userData.email ?? null,
      firstName: userData.firstName ?? null,
      lastName: userData.lastName ?? null,
      profileImageUrl: userData.profileImageUrl ?? null,
      createdAt: existing?.createdAt ? new Date(existing.createdAt) : new Date(now),
      updatedAt: new Date(now),
    };
  };

  async createSession(session: InsertSession & { userId: string }): Promise<Session> {
    const dbData = loadJsonDb();
    const newSession: Session = {
      id: nextId(dbData.sessions as any),
      userId: session.userId,
      mode: session.mode,
      goal: session.goal,
      difficulty: session.difficulty ?? "beginner",
      startedAt: new Date(),
      endedAt: null,
      durationSec: 0,
    } as Session;
    dbData.sessions.push(newSession);
    saveJsonDb(dbData);
    clearProgressCache();
    return newSession;
  }

  async getSession(id: number): Promise<SessionWithMetrics | undefined> {
    const dbData = loadJsonDb();
    const session = dbData.sessions.find((s) => s.id === id);
    if (!session) return undefined;
    const metrics = dbData.metrics.find((m) => m.sessionId === id);
    const events = dbData.events.filter((e) => e.sessionId === id);
    return { ...(session as any), metrics, events };
  }

  async getUserSessions(userId: string, limit = 20, offset = 0): Promise<SessionWithMetrics[]> {
    const dbData = loadJsonDb();
    const sessions = dbData.sessions
      .filter((s) => s.userId === userId)
      .sort((a, b) => {
        const aDate = normalizeDate(a.startedAt)?.getTime() || 0;
        const bDate = normalizeDate(b.startedAt)?.getTime() || 0;
        return bDate - aDate;
      })
      .slice(offset, offset + limit);
    return sessions.map((session) => ({
      ...(session as any),
      metrics: dbData.metrics.find((m) => m.sessionId === session.id),
    }));
  }

  async updateSession(id: number, updates: Partial<Session>): Promise<Session> {
    const dbData = loadJsonDb();
    const session = dbData.sessions.find((s) => s.id === id);
    if (!session) {
      throw new Error("Session not found");
    }
    Object.assign(session, updates);
    saveJsonDb(dbData);
    clearProgressCache();
    return session;
  }

  async addSessionMetrics(metrics: InsertSessionMetrics): Promise<SessionMetrics> {
    const dbData = loadJsonDb();
    const newMetrics: SessionMetrics = {
      id: nextId(dbData.metrics as any),
      sessionId: metrics.sessionId,
      overallScore: metrics.overallScore ?? 0,
      pitchScore: metrics.pitchScore ?? 0,
      rhythmScore: metrics.rhythmScore ?? 0,
      stabilityScore: metrics.stabilityScore ?? 0,
      breathScore: metrics.breathScore ?? 0,
      avgCentsOff: metrics.avgCentsOff ?? 0,
      inTunePercent: metrics.inTunePercent ?? 0,
      stabilityStd: metrics.stabilityStd ?? 0,
      details: metrics.details ?? null,
    } as SessionMetrics;
    dbData.metrics = dbData.metrics.filter((m) => m.sessionId !== metrics.sessionId);
    dbData.metrics.push(newMetrics);
    saveJsonDb(dbData);
    clearProgressCache();
    return newMetrics;
  }

  async addSessionEvents(events: InsertSessionEvent[]): Promise<void> {
    if (events.length === 0) return;
    const dbData = loadJsonDb();
    for (const event of events) {
      const newEvent: SessionEvent = {
        id: nextId(dbData.events as any),
        sessionId: event.sessionId,
        timeMs: event.timeMs,
        type: event.type,
        severity: event.severity ?? 1,
        details: event.details ?? null,
      } as SessionEvent;
      dbData.events.push(newEvent);
    }
    saveJsonDb(dbData);
    clearProgressCache();
  }

  async addAudioArtifact(artifact: InsertAudioArtifact): Promise<AudioArtifact> {
    const dbData = loadJsonDb();
    const newArtifact: AudioArtifact = {
      id: nextId(dbData.artifacts as any),
      sessionId: artifact.sessionId,
      type: artifact.type,
      storagePath: artifact.storagePath,
      publicUrl: artifact.publicUrl ?? null,
      mimeType: artifact.mimeType,
      createdAt: new Date(),
    } as AudioArtifact;
    dbData.artifacts.push(newArtifact);
    saveJsonDb(dbData);
    clearProgressCache();
    return newArtifact;
  }

  async getUserProgress(userId: string) {
    const cached = getCachedProgress(userId);
    if (cached) return cached;

    const dbData = loadJsonDb();
    const userSessions = dbData.sessions
      .filter((s) => s.userId === userId)
      .sort((a, b) => {
        const aDate = normalizeDate(a.startedAt)?.getTime() || 0;
        const bDate = normalizeDate(b.startedAt)?.getTime() || 0;
        return bDate - aDate;
      });
    const recentAttempts = listJsonRecentAttempts(userId, 1000);

    const totalSessions = userSessions.length + recentAttempts.length;
    const totalDurationSec = userSessions.reduce(
      (acc, s) => acc + (s.durationSec || 0),
      0
    );

    const sessionScores = userSessions
      .map((s) => dbData.metrics.find((m) => m.sessionId === s.id)?.overallScore)
      .filter((score): score is number => typeof score === "number");
    const attemptScores = recentAttempts
      .map((attempt) => attempt.scores.overall)
      .filter((score): score is number => typeof score === "number");
    const scores = [...sessionScores, ...attemptScores];
    const averageScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const uniqueDays = new Set(
      [
        ...userSessions.map((s) =>
          normalizeDate(s.startedAt)?.toDateString() || ""
        ),
        ...recentAttempts.map((attempt) =>
          normalizeDate(attempt.createdAt)?.toDateString() || ""
        ),
      ].filter(Boolean)
    );
    const streakDays = uniqueDays.size;

    const recentScores = [
      ...userSessions.map((s) => ({
        date: normalizeDate(s.startedAt)?.toISOString() || new Date().toISOString(),
        score:
          dbData.metrics.find((m) => m.sessionId === s.id)?.overallScore || 0,
      })),
      ...recentAttempts.map((attempt) => ({
        date: normalizeDate(attempt.createdAt)?.toISOString() || new Date().toISOString(),
        score: attempt.scores.overall || 0,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)
      .reverse();

    const computed = {
      totalSessions,
      totalDurationSec,
      averageScore,
      streakDays,
      recentScores,
    };
    setCachedProgress(userId, computed);
    return computed;
  }
}

const useJsonStorage = !db || process.env.USE_JSON_DB?.toLowerCase() === "true";

export const storage = useJsonStorage ? new JsonStorage() : new DatabaseStorage();
