import { db } from "./db";
import { 
  sessions, sessionMetrics, sessionEvents, audioArtifacts,
  type Session, type InsertSession, 
  type SessionMetrics, type InsertSessionMetrics,
  type SessionEvent, type InsertSessionEvent,
  type AudioArtifact, type InsertAudioArtifact,
  type SessionWithMetrics
} from "@shared/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { authStorage, type IAuthStorage } from "./replit_integrations/auth";

export interface IStorage extends IAuthStorage {
  // Session operations
  createSession(session: InsertSession): Promise<Session>;
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
    totalDuration: number;
    avgScore: number;
    streakDays: number;
    recentScores: { date: string, score: number }[];
  }>;
}

export class DatabaseStorage implements IStorage {
  // Inherit auth methods
  getUser = authStorage.getUser;
  upsertUser = authStorage.upsertUser;

  async createSession(session: InsertSession): Promise<Session> {
    const [newSession] = await db.insert(sessions).values(session).returning();
    return newSession;
  }

  async getSession(id: number): Promise<SessionWithMetrics | undefined> {
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, id),
      with: {
        metrics: true,
        events: true,
      }
    });
    return session;
  }

  async getUserSessions(userId: string, limit = 20, offset = 0): Promise<SessionWithMetrics[]> {
    return await db.query.sessions.findMany({
      where: eq(sessions.userId, userId),
      limit,
      offset,
      orderBy: desc(sessions.startedAt),
      with: {
        metrics: true,
      }
    });
  }

  async updateSession(id: number, updates: Partial<Session>): Promise<Session> {
    const [updated] = await db
      .update(sessions)
      .set(updates)
      .where(eq(sessions.id, id))
      .returning();
    return updated;
  }

  async addSessionMetrics(metrics: InsertSessionMetrics): Promise<SessionMetrics> {
    const [newMetrics] = await db.insert(sessionMetrics).values(metrics).returning();
    return newMetrics;
  }

  async addSessionEvents(events: InsertSessionEvent[]): Promise<void> {
    if (events.length === 0) return;
    await db.insert(sessionEvents).values(events);
  }

  async addAudioArtifact(artifact: InsertAudioArtifact): Promise<AudioArtifact> {
    const [newArtifact] = await db.insert(audioArtifacts).values(artifact).returning();
    return newArtifact;
  }

  async getUserProgress(userId: string) {
    // This is a simplified aggregation. In a real app with huge data, 
    // we might want to maintain a separate 'user_stats' table.
    
    const userSessions = await db.select({
      id: sessions.id,
      duration: sessions.durationSec,
      startedAt: sessions.startedAt,
      score: sessionMetrics.overallScore,
    })
    .from(sessions)
    .leftJoin(sessionMetrics, eq(sessions.id, sessionMetrics.sessionId))
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt));

    const totalSessions = userSessions.length;
    const totalDuration = userSessions.reduce((acc, s) => acc + (s.duration || 0), 0);
    
    const scores = userSessions.filter(s => s.score !== null).map(s => s.score!);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    // Calculate streak (consecutive days)
    // Simplified: just check distinct days in recent history
    const uniqueDays = new Set(
      userSessions.map(s => s.startedAt ? new Date(s.startedAt).toDateString() : "")
    );
    // TODO: Implement real streak logic (checking gaps)
    const streakDays = uniqueDays.size; // Placeholder

    const recentScores = userSessions
      .slice(0, 10)
      .filter(s => s.score !== null && s.startedAt)
      .map(s => ({
        date: s.startedAt!.toISOString(),
        score: s.score!
      }))
      .reverse();

    return {
      totalSessions,
      totalDuration,
      avgScore,
      streakDays,
      recentScores
    };
  }
}

export const storage = new DatabaseStorage();
