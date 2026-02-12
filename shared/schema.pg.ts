import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  doublePrecision,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./models/auth.pg";

// === SINGING SESSIONS ===
export const singingSessions = pgTable("singing_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(), // Linked to auth.users.id
  mode: text("mode").notNull(), // 'live_coach', 'scales', 'song_practice', 'sustained_note'
  goal: text("goal").notNull(), // 'pitch', 'rhythm', 'stability', 'breath', 'overall'
  difficulty: text("difficulty").default("beginner"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  durationSec: integer("duration_sec").default(0),
});

export const singingSessionsRelations = relations(
  singingSessions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [singingSessions.userId],
      references: [users.id],
    }),
    metrics: one(sessionMetrics, {
      fields: [singingSessions.id],
      references: [sessionMetrics.sessionId],
    }),
    events: many(sessionEvents),
    artifacts: many(audioArtifacts),
  })
);

export const insertSessionSchema = createInsertSchema(singingSessions).omit({
  id: true,
  userId: true,
  startedAt: true,
  endedAt: true,
  durationSec: true,
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
  session: one(singingSessions, {
    fields: [sessionMetrics.sessionId],
    references: [singingSessions.id],
  }),
}));

export const insertSessionMetricsSchema = createInsertSchema(
  sessionMetrics
).omit({ id: true });

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
  session: one(singingSessions, {
    fields: [sessionEvents.sessionId],
    references: [singingSessions.id],
  }),
}));

export const insertSessionEventSchema = createInsertSchema(sessionEvents).omit({
  id: true,
});

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
  session: one(singingSessions, {
    fields: [audioArtifacts.sessionId],
    references: [singingSessions.id],
  }),
}));

export const insertAudioArtifactSchema = createInsertSchema(
  audioArtifacts
).omit({ id: true, createdAt: true });

// === EXPLICIT API TYPES ===

// === LIVE COACHING UPLOADS ===
export const liveCoachingUploads = pgTable(
  "live_coaching_uploads",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    publicUrl: text("public_url").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("live_coaching_uploads_user_id_idx").on(table.userId),
    createdIdx: index("live_coaching_uploads_created_at_idx").on(table.createdAt),
  })
);

export const insertLiveCoachingUploadSchema = createInsertSchema(
  liveCoachingUploads
).omit({ id: true, createdAt: true });

// === LIVE COACHING RECORDINGS ===
export const liveCoachingRecordings = pgTable(
  "live_coaching_recordings",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    storagePath: text("storage_path").notNull(),
    publicUrl: text("public_url").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").default(0),
    durationSec: doublePrecision("duration_sec").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("live_coaching_recordings_user_id_idx").on(table.userId),
    createdIdx: index("live_coaching_recordings_created_at_idx").on(table.createdAt),
  })
);

export const insertLiveCoachingRecordingSchema = createInsertSchema(
  liveCoachingRecordings
).omit({ id: true, createdAt: true });

// === LIVE COACHING ATTEMPTS ===
export const liveCoachingAttempts = pgTable(
  "live_coaching_attempts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    uploadId: integer("upload_id").notNull(),
    recordingId: integer("recording_id"),
    verseIndex: integer("verse_index").default(0),
    verseCount: integer("verse_count").default(1),
    scoreOverall: integer("score_overall").default(0),
    scorePitch: integer("score_pitch").default(0),
    scoreTiming: integer("score_timing").default(0),
    scoreStability: integer("score_stability").default(0),
    scoreWords: integer("score_words").default(0),
    scoreLabel: text("score_label").default("Performance"),
    tips: jsonb("tips").$type<string[]>(),
    focusLine: text("focus_line"),
    focusAreas: jsonb("focus_areas").$type<string[]>(),
    practiceMode: text("practice_mode").default("full"),
    debug: jsonb("debug").$type<Record<string, any>>(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("live_coaching_attempts_user_id_idx").on(table.userId),
    createdIdx: index("live_coaching_attempts_created_at_idx").on(table.createdAt),
    uploadIdx: index("live_coaching_attempts_upload_id_idx").on(table.uploadId),
  })
);

export const insertLiveCoachingAttemptSchema = createInsertSchema(
  liveCoachingAttempts
).omit({ id: true, createdAt: true });

// === LOCAL AUTH CREDENTIALS ===
export const localCredentials = pgTable(
  "local_credentials",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("local_credentials_user_id_idx").on(table.userId),
    emailIdx: index("local_credentials_email_idx").on(table.email),
  })
);

export const insertLocalCredentialsSchema = createInsertSchema(
  localCredentials
).omit({ id: true, createdAt: true, updatedAt: true });

// === USER SETTINGS / RBAC / CONSENT ===
export const userSettings = pgTable(
  "user_settings",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    role: text("role").notNull().default("user"),
    locale: text("locale").notNull().default("en"),
    consentVersion: text("consent_version"),
    consentGivenAt: timestamp("consent_given_at"),
    onboardingCompletedAt: timestamp("onboarding_completed_at"),
    emailNotifications: boolean("email_notifications").notNull().default(true),
    inAppNotifications: boolean("in_app_notifications").notNull().default(true),
    updatedAt: timestamp("updated_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("user_settings_user_id_idx").on(table.userId),
    roleIdx: index("user_settings_role_idx").on(table.role),
  })
);

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// === PASSWORD RESET TOKENS ===
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("password_reset_tokens_user_id_idx").on(table.userId),
    expiresIdx: index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
  })
);

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({
  id: true,
  usedAt: true,
  createdAt: true,
});

// === OPTIONAL MFA FACTORS ===
export const userMfaFactors = pgTable(
  "user_mfa_factors",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    secret: text("secret").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    recoveryCodes: jsonb("recovery_codes").$type<string[]>(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("user_mfa_factors_user_id_idx").on(table.userId),
  })
);

export const insertUserMfaFactorSchema = createInsertSchema(userMfaFactors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// === AUDIT LOGS ===
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id"),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    details: jsonb("details").$type<Record<string, any>>(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("audit_logs_user_id_idx").on(table.userId),
    actionIdx: index("audit_logs_action_idx").on(table.action),
    createdIdx: index("audit_logs_created_at_idx").on(table.createdAt),
  })
);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

// === ANALYTICS EVENTS ===
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id"),
    name: text("name").notNull(),
    properties: jsonb("properties").$type<Record<string, any>>(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("analytics_events_user_id_idx").on(table.userId),
    nameIdx: index("analytics_events_name_idx").on(table.name),
    createdIdx: index("analytics_events_created_at_idx").on(table.createdAt),
  })
);

export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({
  id: true,
  createdAt: true,
});

// === FEEDBACK REPORTS ===
export const feedbackReports = pgTable(
  "feedback_reports",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id"),
    category: text("category").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("feedback_reports_user_id_idx").on(table.userId),
    statusIdx: index("feedback_reports_status_idx").on(table.status),
  })
);

export const insertFeedbackReportSchema = createInsertSchema(feedbackReports).omit({
  id: true,
  status: true,
  createdAt: true,
});

// === IN-APP NOTIFICATIONS ===
export const notificationItems = pgTable(
  "notification_items",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("notification_items_user_id_idx").on(table.userId),
    readIdx: index("notification_items_read_at_idx").on(table.readAt),
    createdIdx: index("notification_items_created_at_idx").on(table.createdAt),
  })
);

export const insertNotificationItemSchema = createInsertSchema(notificationItems).omit({
  id: true,
  readAt: true,
  createdAt: true,
});

// === PRIVACY REQUESTS ===
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestType: text("request_type").notNull(),
    status: text("status").notNull().default("open"),
    payload: jsonb("payload").$type<Record<string, any>>(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userIdx: index("privacy_requests_user_id_idx").on(table.userId),
    typeIdx: index("privacy_requests_type_idx").on(table.requestType),
    statusIdx: index("privacy_requests_status_idx").on(table.status),
  })
);

export const insertPrivacyRequestSchema = createInsertSchema(privacyRequests).omit({
  id: true,
  status: true,
  createdAt: true,
});

export type Session = typeof singingSessions.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;

export type SessionMetrics = typeof sessionMetrics.$inferSelect;
export type InsertSessionMetrics = z.infer<typeof insertSessionMetricsSchema>;

export type SessionEvent = typeof sessionEvents.$inferSelect;
export type InsertSessionEvent = z.infer<typeof insertSessionEventSchema>;

export type AudioArtifact = typeof audioArtifacts.$inferSelect;
export type InsertAudioArtifact = z.infer<typeof insertAudioArtifactSchema>;

export type LiveCoachingUpload = typeof liveCoachingUploads.$inferSelect;
export type InsertLiveCoachingUpload = z.infer<typeof insertLiveCoachingUploadSchema>;

export type LiveCoachingRecording = typeof liveCoachingRecordings.$inferSelect;
export type InsertLiveCoachingRecording = z.infer<typeof insertLiveCoachingRecordingSchema>;

export type LiveCoachingAttempt = typeof liveCoachingAttempts.$inferSelect;
export type InsertLiveCoachingAttempt = z.infer<typeof insertLiveCoachingAttemptSchema>;

export type LocalCredentials = typeof localCredentials.$inferSelect;
export type InsertLocalCredentials = z.infer<typeof insertLocalCredentialsSchema>;

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;

export type UserMfaFactor = typeof userMfaFactors.$inferSelect;
export type InsertUserMfaFactor = z.infer<typeof insertUserMfaFactorSchema>;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;

export type FeedbackReport = typeof feedbackReports.$inferSelect;
export type InsertFeedbackReport = z.infer<typeof insertFeedbackReportSchema>;

export type NotificationItem = typeof notificationItems.$inferSelect;
export type InsertNotificationItem = z.infer<typeof insertNotificationItemSchema>;

export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export type InsertPrivacyRequest = z.infer<typeof insertPrivacyRequestSchema>;

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
