import { pgTable, text, serial, integer, boolean, timestamp, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth";

export * from "./models/auth";

// === SESSIONS ===
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // Linked to auth.users.id
  mode: text("mode").notNull(), // 'live_coach', 'scales', 'song_practice', 'sustained_note'
  goal: text("goal").notNull(), // 'pitch', 'rhythm', 'stability', 'breath', 'overall'
  difficulty: text("difficulty").default("beginner"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  durationSec: integer("duration_sec").default(0),
});

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  metrics: one(sessionMetrics, {
    fields: [sessions.id],
    references: [sessionMetrics.sessionId],
  }),
  events: many(sessionEvents),
  artifacts: many(audioArtifacts),
}));

export const insertSessionSchema = createInsertSchema(sessions).omit({ 
  id: true, 
  startedAt: true, 
  endedAt: true,
  durationSec: true 
});

// === SESSION METRICS ===
export const sessionMetrics = pgTable("session_metrics", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  overallScore: integer("overall_score").default(0),
  pitchScore: integer("pitch_score").default(0),
  rhythmScore: integer("rhythm_score").default(0),
  stabilityScore: integer("stability_score").default(0),
  breathScore: integer("breath_score").default(0),
  avgCentsOff: doublePrecision("avg_cents_off").default(0),
  inTunePercent: doublePrecision("in_tune_percent").default(0),
  stabilityStd: doublePrecision("stability_std").default(0),
  details: jsonb("details").$type<Record<string, any>>(), // Extra stats
});

export const sessionMetricsRelations = relations(sessionMetrics, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionMetrics.sessionId],
    references: [sessions.id],
  }),
}));

export const insertSessionMetricsSchema = createInsertSchema(sessionMetrics).omit({ id: true });

// === SESSION EVENTS (Markers) ===
export const sessionEvents = pgTable("session_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  timeMs: integer("time_ms").notNull(),
  type: text("type").notNull(), // 'pitch_error', 'instability', 'good_moment', 'breath'
  severity: integer("severity").default(1), // 1-5
  details: jsonb("details").$type<Record<string, any>>(),
});

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionEvents.sessionId],
    references: [sessions.id],
  }),
}));

export const insertSessionEventSchema = createInsertSchema(sessionEvents).omit({ id: true });

// === AUDIO ARTIFACTS ===
export const audioArtifacts = pgTable("audio_artifacts", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull(),
  type: text("type").notNull(), // 'user_recording', 'reference_track'
  storagePath: text("storage_path").notNull(),
  publicUrl: text("public_url"),
  mimeType: text("mime_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const audioArtifactsRelations = relations(audioArtifacts, ({ one }) => ({
  session: one(sessions, {
    fields: [audioArtifacts.sessionId],
    references: [sessions.id],
  }),
}));

export const insertAudioArtifactSchema = createInsertSchema(audioArtifacts).omit({ id: true, createdAt: true, publicUrl: true });

// === EXPLICIT API TYPES ===

export type Session = typeof sessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type SessionMetrics = typeof sessionMetrics.$inferSelect;
export type InsertSessionMetrics = z.infer<typeof insertSessionMetricsSchema>;

export type SessionEvent = typeof sessionEvents.$inferSelect;
export type InsertSessionEvent = z.infer<typeof insertSessionEventSchema>;

export type AudioArtifact = typeof audioArtifacts.$inferSelect;
export type InsertAudioArtifact = z.infer<typeof insertAudioArtifactSchema>;

// Complex types for API responses
export type SessionWithMetrics = Session & {
  metrics?: SessionMetrics;
  events?: SessionEvent[];
};

export type CreateSessionRequest = InsertSession;
export type FinishSessionRequest = {
  durationSec: number;
  metrics: InsertSessionMetrics;
  events?: InsertSessionEvent[];
};

export type FileUploadResponse = {
  id: number;
  url: string;
  filename: string;
};
