import { z } from "zod";
import * as pgSchema from "./schema.pg";
import * as sqliteSchema from "./schema.sqlite";

function detectSqlite(): boolean {
  if (typeof process === "undefined" || !process.env) {
    return false;
  }
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("file:") || url.startsWith("sqlite:");
}

const useSqlite = detectSqlite();

export * from "./models/auth";

export const singingSessions = useSqlite
  ? sqliteSchema.singingSessions
  : pgSchema.singingSessions;
export const singingSessionsRelations = useSqlite
  ? sqliteSchema.singingSessionsRelations
  : pgSchema.singingSessionsRelations;

export const sessionMetrics = useSqlite
  ? sqliteSchema.sessionMetrics
  : pgSchema.sessionMetrics;
export const sessionMetricsRelations = useSqlite
  ? sqliteSchema.sessionMetricsRelations
  : pgSchema.sessionMetricsRelations;

export const sessionEvents = useSqlite
  ? sqliteSchema.sessionEvents
  : pgSchema.sessionEvents;
export const sessionEventsRelations = useSqlite
  ? sqliteSchema.sessionEventsRelations
  : pgSchema.sessionEventsRelations;

export const audioArtifacts = useSqlite
  ? sqliteSchema.audioArtifacts
  : pgSchema.audioArtifacts;
export const audioArtifactsRelations = useSqlite
  ? sqliteSchema.audioArtifactsRelations
  : pgSchema.audioArtifactsRelations;

export const liveCoachingUploads = useSqlite
  ? sqliteSchema.liveCoachingUploads
  : pgSchema.liveCoachingUploads;
export const liveCoachingRecordings = useSqlite
  ? sqliteSchema.liveCoachingRecordings
  : pgSchema.liveCoachingRecordings;
export const liveCoachingAttempts = useSqlite
  ? sqliteSchema.liveCoachingAttempts
  : pgSchema.liveCoachingAttempts;
export const localCredentials = useSqlite
  ? sqliteSchema.localCredentials
  : pgSchema.localCredentials;
export const userSettings = useSqlite
  ? sqliteSchema.userSettings
  : pgSchema.userSettings;
export const passwordResetTokens = useSqlite
  ? sqliteSchema.passwordResetTokens
  : pgSchema.passwordResetTokens;
export const userMfaFactors = useSqlite
  ? sqliteSchema.userMfaFactors
  : pgSchema.userMfaFactors;
export const auditLogs = useSqlite
  ? sqliteSchema.auditLogs
  : pgSchema.auditLogs;
export const analyticsEvents = useSqlite
  ? sqliteSchema.analyticsEvents
  : pgSchema.analyticsEvents;
export const feedbackReports = useSqlite
  ? sqliteSchema.feedbackReports
  : pgSchema.feedbackReports;
export const notificationItems = useSqlite
  ? sqliteSchema.notificationItems
  : pgSchema.notificationItems;
export const privacyRequests = useSqlite
  ? sqliteSchema.privacyRequests
  : pgSchema.privacyRequests;

export const insertSessionSchema = useSqlite
  ? sqliteSchema.insertSessionSchema
  : pgSchema.insertSessionSchema;
export const insertSessionMetricsSchema = useSqlite
  ? sqliteSchema.insertSessionMetricsSchema
  : pgSchema.insertSessionMetricsSchema;
export const insertSessionEventSchema = useSqlite
  ? sqliteSchema.insertSessionEventSchema
  : pgSchema.insertSessionEventSchema;
export const insertAudioArtifactSchema = useSqlite
  ? sqliteSchema.insertAudioArtifactSchema
  : pgSchema.insertAudioArtifactSchema;
export const insertLiveCoachingUploadSchema = useSqlite
  ? sqliteSchema.insertLiveCoachingUploadSchema
  : pgSchema.insertLiveCoachingUploadSchema;
export const insertLiveCoachingRecordingSchema = useSqlite
  ? sqliteSchema.insertLiveCoachingRecordingSchema
  : pgSchema.insertLiveCoachingRecordingSchema;
export const insertLiveCoachingAttemptSchema = useSqlite
  ? sqliteSchema.insertLiveCoachingAttemptSchema
  : pgSchema.insertLiveCoachingAttemptSchema;
export const insertLocalCredentialsSchema = useSqlite
  ? sqliteSchema.insertLocalCredentialsSchema
  : pgSchema.insertLocalCredentialsSchema;
export const insertUserSettingsSchema = useSqlite
  ? sqliteSchema.insertUserSettingsSchema
  : pgSchema.insertUserSettingsSchema;
export const insertPasswordResetTokenSchema = useSqlite
  ? sqliteSchema.insertPasswordResetTokenSchema
  : pgSchema.insertPasswordResetTokenSchema;
export const insertUserMfaFactorSchema = useSqlite
  ? sqliteSchema.insertUserMfaFactorSchema
  : pgSchema.insertUserMfaFactorSchema;
export const insertAuditLogSchema = useSqlite
  ? sqliteSchema.insertAuditLogSchema
  : pgSchema.insertAuditLogSchema;
export const insertAnalyticsEventSchema = useSqlite
  ? sqliteSchema.insertAnalyticsEventSchema
  : pgSchema.insertAnalyticsEventSchema;
export const insertFeedbackReportSchema = useSqlite
  ? sqliteSchema.insertFeedbackReportSchema
  : pgSchema.insertFeedbackReportSchema;
export const insertNotificationItemSchema = useSqlite
  ? sqliteSchema.insertNotificationItemSchema
  : pgSchema.insertNotificationItemSchema;
export const insertPrivacyRequestSchema = useSqlite
  ? sqliteSchema.insertPrivacyRequestSchema
  : pgSchema.insertPrivacyRequestSchema;

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

export type SessionWithMetrics = Session & {
  metrics?: SessionMetrics;
  events?: SessionEvent[];
};

export type CreateSessionRequest = InsertSession;
export type FinishSessionRequest = {
  durationSec: number;
  metrics: Omit<InsertSessionMetrics, "sessionId">;
  events?: InsertSessionEvent[];
};

export type FileUploadResponse = {
  id: number;
  url: string;
  filename: string;
};
