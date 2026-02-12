import crypto from "crypto";
import fs from "fs";
import path from "path";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "./db";
import {
  analyticsEvents,
  auditLogs,
  feedbackReports,
  liveCoachingAttempts,
  liveCoachingRecordings,
  liveCoachingUploads,
  notificationItems,
  passwordResetTokens,
  privacyRequests,
  singingSessions,
  userMfaFactors,
  userSettings,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { localCredentials } from "@shared/schema";

type JsonRecord = Record<string, any>;

type PlatformJsonDb = {
  userSettings: JsonRecord[];
  passwordResetTokens: JsonRecord[];
  userMfaFactors: JsonRecord[];
  auditLogs: JsonRecord[];
  analyticsEvents: JsonRecord[];
  feedbackReports: JsonRecord[];
  notificationItems: JsonRecord[];
  privacyRequests: JsonRecord[];
};

const storePath = path.join(process.cwd(), "server", "data", "platform-store.json");
const useJsonStore = !db || process.env.USE_JSON_DB?.toLowerCase() === "true";

const now = () => new Date();
const normalizeDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  if (typeof value === "string") return new Date(value);
  return null;
};

const nextId = (items: JsonRecord[]): number =>
  items.length ? Math.max(...items.map((item) => Number(item.id) || 0)) + 1 : 1;

function loadJsonDb(): PlatformJsonDb {
  if (!fs.existsSync(storePath)) {
    return {
      userSettings: [],
      passwordResetTokens: [],
      userMfaFactors: [],
      auditLogs: [],
      analyticsEvents: [],
      feedbackReports: [],
      notificationItems: [],
      privacyRequests: [],
    };
  }
  const raw = fs.readFileSync(storePath, "utf8");
  const parsed = JSON.parse(raw) as PlatformJsonDb;
  return {
    userSettings: parsed.userSettings || [],
    passwordResetTokens: parsed.passwordResetTokens || [],
    userMfaFactors: parsed.userMfaFactors || [],
    auditLogs: parsed.auditLogs || [],
    analyticsEvents: parsed.analyticsEvents || [],
    feedbackReports: parsed.feedbackReports || [],
    notificationItems: parsed.notificationItems || [],
    privacyRequests: parsed.privacyRequests || [],
  };
}

function saveJsonDb(value: PlatformJsonDb): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(value, null, 2), "utf8");
}

const defaultSettings = (userId: string) => ({
  userId,
  role: "user",
  locale: "en",
  consentVersion: null as string | null,
  consentGivenAt: null as Date | null,
  onboardingCompletedAt: null as Date | null,
  emailNotifications: true,
  inAppNotifications: true,
});

export async function getOrCreateUserSettings(userId: string) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const existing = state.userSettings.find((entry) => entry.userId === userId);
    if (existing) {
      return {
        ...defaultSettings(userId),
        ...existing,
        consentGivenAt: normalizeDate(existing.consentGivenAt),
        onboardingCompletedAt: normalizeDate(existing.onboardingCompletedAt),
      };
    }
    const created = {
      id: nextId(state.userSettings),
      ...defaultSettings(userId),
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    };
    state.userSettings.push(created);
    saveJsonDb(state);
    return created;
  }

  const dbAny = db as any;
  const [existing] = await dbAny
    .select()
    .from(userSettings as any)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (existing) return existing;
  const [created] = await dbAny
    .insert(userSettings as any)
    .values({
      userId,
      role: "user",
      locale: "en",
      emailNotifications: true,
      inAppNotifications: true,
      updatedAt: now(),
    })
    .returning();
  return created;
}

export async function updateUserSettings(userId: string, updates: Partial<{
  role: string;
  locale: string;
  consentVersion: string | null;
  consentGivenAt: Date | null;
  onboardingCompletedAt: Date | null;
  emailNotifications: boolean;
  inAppNotifications: boolean;
}>) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const existingIndex = state.userSettings.findIndex((entry) => entry.userId === userId);
    if (existingIndex === -1) {
      const created = {
        id: nextId(state.userSettings),
        ...defaultSettings(userId),
        ...updates,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      state.userSettings.push(created);
      saveJsonDb(state);
      return created;
    }
    state.userSettings[existingIndex] = {
      ...state.userSettings[existingIndex],
      ...updates,
      updatedAt: now().toISOString(),
    };
    saveJsonDb(state);
    return state.userSettings[existingIndex];
  }

  const dbAny = db as any;
  const [existing] = await dbAny
    .select()
    .from(userSettings as any)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!existing) {
    const [created] = await dbAny
      .insert(userSettings as any)
      .values({
        userId,
        role: updates.role ?? "user",
        locale: updates.locale ?? "en",
        consentVersion: updates.consentVersion ?? null,
        consentGivenAt: updates.consentGivenAt ?? null,
        onboardingCompletedAt: updates.onboardingCompletedAt ?? null,
        emailNotifications: updates.emailNotifications ?? true,
        inAppNotifications: updates.inAppNotifications ?? true,
        updatedAt: now(),
      })
      .returning();
    if (created) return created;
    const [fallbackCreated] = await dbAny
      .select()
      .from(userSettings as any)
      .where(eq(userSettings.userId, userId))
      .limit(1);
    return fallbackCreated;
  }
  const payload = Object.fromEntries(
    Object.entries({
      role: updates.role,
      locale: updates.locale,
      consentVersion: updates.consentVersion,
      consentGivenAt: updates.consentGivenAt,
      onboardingCompletedAt: updates.onboardingCompletedAt,
      emailNotifications: updates.emailNotifications,
      inAppNotifications: updates.inAppNotifications,
      updatedAt: now(),
    }).filter(([, value]) => value !== undefined),
  );
  const [updated] = await dbAny
    .update(userSettings as any)
    .set(payload)
    .where(eq(userSettings.userId, userId))
    .returning();
  if (updated) return updated;
  const [fallbackUpdated] = await dbAny
    .select()
    .from(userSettings as any)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return fallbackUpdated;
}

export async function createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const record = {
      id: nextId(state.passwordResetTokens),
      userId,
      tokenHash,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      createdAt: now().toISOString(),
    };
    state.passwordResetTokens.push(record);
    saveJsonDb(state);
    return record;
  }
  const dbAny = db as any;
  const [created] = await dbAny
    .insert(passwordResetTokens as any)
    .values({
      userId,
      tokenHash,
      expiresAt,
    })
    .returning();
  return created;
}

export async function consumePasswordResetToken(tokenHash: string): Promise<string | null> {
  const current = now();
  if (useJsonStore) {
    const state = loadJsonDb();
    const token = state.passwordResetTokens.find((entry) => entry.tokenHash === tokenHash);
    if (!token) return null;
    if (token.usedAt) return null;
    const expiresAt = normalizeDate(token.expiresAt);
    if (!expiresAt || expiresAt.getTime() < current.getTime()) return null;
    token.usedAt = current.toISOString();
    saveJsonDb(state);
    return token.userId;
  }

  const dbAny = db as any;
  const [token] = await dbAny
    .select()
    .from(passwordResetTokens as any)
    .where(and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)))
    .limit(1);
  if (!token) return null;
  const expiresAt = normalizeDate((token as any).expiresAt ?? (token as any).expires_at);
  if (!expiresAt || expiresAt.getTime() < current.getTime()) return null;
  await dbAny
    .update(passwordResetTokens as any)
    .set({ usedAt: current })
    .where(eq(passwordResetTokens.id, (token as any).id));
  return ((token as any).userId ?? (token as any).user_id) as string;
}

export async function purgeExpiredPasswordResetTokens() {
  if (useJsonStore) {
    const state = loadJsonDb();
    const threshold = now().getTime();
    state.passwordResetTokens = state.passwordResetTokens.filter((entry) => {
      const expiresAt = normalizeDate(entry.expiresAt);
      return !!expiresAt && expiresAt.getTime() > threshold;
    });
    saveJsonDb(state);
    return;
  }
  const dbAny = db as any;
  await dbAny
    .delete(passwordResetTokens as any)
    .where(lt(passwordResetTokens.expiresAt, now()));
}

export async function getUserMfa(userId: string) {
  if (useJsonStore) {
    const state = loadJsonDb();
    return state.userMfaFactors.find((entry) => entry.userId === userId) ?? null;
  }
  const dbAny = db as any;
  const [record] = await dbAny
    .select()
    .from(userMfaFactors as any)
    .where(eq(userMfaFactors.userId, userId))
    .limit(1);
  return record ?? null;
}

export async function upsertUserMfa(userId: string, secret: string, enabled = false, recoveryCodes: string[] = []) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const index = state.userMfaFactors.findIndex((entry) => entry.userId === userId);
    if (index === -1) {
      const created = {
        id: nextId(state.userMfaFactors),
        userId,
        secret,
        enabled,
        recoveryCodes,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      };
      state.userMfaFactors.push(created);
      saveJsonDb(state);
      return created;
    }
    state.userMfaFactors[index] = {
      ...state.userMfaFactors[index],
      secret,
      enabled,
      recoveryCodes,
      updatedAt: now().toISOString(),
    };
    saveJsonDb(state);
    return state.userMfaFactors[index];
  }
  const dbAny = db as any;
  const [existing] = await dbAny
    .select()
    .from(userMfaFactors as any)
    .where(eq(userMfaFactors.userId, userId))
    .limit(1);
  if (!existing) {
    const [created] = await dbAny
      .insert(userMfaFactors as any)
      .values({
        userId,
        secret,
        enabled,
        recoveryCodes,
        updatedAt: now(),
      })
      .returning();
    return created;
  }
  const [updated] = await dbAny
    .update(userMfaFactors as any)
    .set({
      secret,
      enabled,
      recoveryCodes,
      updatedAt: now(),
    })
    .where(eq(userMfaFactors.userId, userId))
    .returning();
  return updated;
}

export async function addAuditLog(input: {
  userId?: string | null;
  action: string;
  resource: string;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, any> | null;
}) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const record = {
      id: nextId(state.auditLogs),
      userId: input.userId ?? null,
      action: input.action,
      resource: input.resource,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      details: input.details ?? null,
      createdAt: now().toISOString(),
    };
    state.auditLogs.push(record);
    saveJsonDb(state);
    return record;
  }
  const dbAny = db as any;
  const [created] = await dbAny
    .insert(auditLogs as any)
    .values({
      userId: input.userId ?? null,
      action: input.action,
      resource: input.resource,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      details: input.details ?? null,
    })
    .returning();
  return created;
}

export async function addAnalyticsEvent(input: {
  userId?: string | null;
  name: string;
  properties?: Record<string, any> | null;
}) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const record = {
      id: nextId(state.analyticsEvents),
      userId: input.userId ?? null,
      name: input.name,
      properties: input.properties ?? null,
      createdAt: now().toISOString(),
    };
    state.analyticsEvents.push(record);
    saveJsonDb(state);
    return record;
  }
  const dbAny = db as any;
  const [created] = await dbAny
    .insert(analyticsEvents as any)
    .values({
      userId: input.userId ?? null,
      name: input.name,
      properties: input.properties ?? null,
    })
    .returning();
  return created;
}

export async function addFeedbackReport(input: {
  userId?: string | null;
  category: string;
  message: string;
}) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const record = {
      id: nextId(state.feedbackReports),
      userId: input.userId ?? null,
      category: input.category,
      message: input.message,
      status: "open",
      createdAt: now().toISOString(),
    };
    state.feedbackReports.push(record);
    saveJsonDb(state);
    return record;
  }
  const dbAny = db as any;
  const [created] = await dbAny
    .insert(feedbackReports as any)
    .values({
      userId: input.userId ?? null,
      category: input.category,
      message: input.message,
      status: "open",
    })
    .returning();
  return created;
}

export async function addNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
}) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const record = {
      id: nextId(state.notificationItems),
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      readAt: null,
      createdAt: now().toISOString(),
    };
    state.notificationItems.push(record);
    saveJsonDb(state);
    return record;
  }
  const dbAny = db as any;
  const [created] = await dbAny
    .insert(notificationItems as any)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
    })
    .returning();
  return created;
}

export async function listNotifications(userId: string, limit = 25) {
  if (useJsonStore) {
    const state = loadJsonDb();
    return state.notificationItems
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.max(1, limit));
  }
  const dbAny = db as any;
  return dbAny
    .select()
    .from(notificationItems as any)
    .where(eq(notificationItems.userId, userId))
    .orderBy(desc(notificationItems.createdAt))
    .limit(Math.max(1, limit));
}

export async function markNotificationRead(userId: string, notificationId: number) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const index = state.notificationItems.findIndex(
      (entry) => entry.userId === userId && Number(entry.id) === notificationId,
    );
    if (index === -1) return null;
    state.notificationItems[index].readAt = now().toISOString();
    saveJsonDb(state);
    return state.notificationItems[index];
  }
  const dbAny = db as any;
  const [updated] = await dbAny
    .update(notificationItems as any)
    .set({ readAt: now() })
    .where(and(eq(notificationItems.id, notificationId), eq(notificationItems.userId, userId)))
    .returning();
  return updated ?? null;
}

export async function createPrivacyRequest(input: {
  userId: string;
  requestType: "export" | "delete" | "access";
  payload?: Record<string, any> | null;
}) {
  if (useJsonStore) {
    const state = loadJsonDb();
    const record = {
      id: nextId(state.privacyRequests),
      userId: input.userId,
      requestType: input.requestType,
      status: "open",
      payload: input.payload ?? null,
      createdAt: now().toISOString(),
    };
    state.privacyRequests.push(record);
    saveJsonDb(state);
    return record;
  }
  const dbAny = db as any;
  const [created] = await dbAny
    .insert(privacyRequests as any)
    .values({
      userId: input.userId,
      requestType: input.requestType,
      status: "open",
      payload: input.payload ?? null,
    })
    .returning();
  return created;
}

export async function exportUserData(userId: string) {
  if (useJsonStore) {
    const state = loadJsonDb();
    return {
      userId,
      userSettings: state.userSettings.find((entry) => entry.userId === userId) ?? null,
      notifications: state.notificationItems.filter((entry) => entry.userId === userId),
      feedback: state.feedbackReports.filter((entry) => entry.userId === userId),
      privacyRequests: state.privacyRequests.filter((entry) => entry.userId === userId),
      analyticsEvents: state.analyticsEvents.filter((entry) => entry.userId === userId),
      auditLogs: state.auditLogs.filter((entry) => entry.userId === userId),
    };
  }

  const dbAny = db as any;
  const [user] = await dbAny.select().from(users as any).where(eq(users.id, userId));
  const [settings] = await dbAny
    .select()
    .from(userSettings as any)
    .where(eq(userSettings.userId, userId));
  const sessionsList = await dbAny
    .select()
    .from(singingSessions as any)
    .where(eq(singingSessions.userId, userId));
  const uploads = await dbAny
    .select()
    .from(liveCoachingUploads as any)
    .where(eq(liveCoachingUploads.userId, userId));
  const recordings = await dbAny
    .select()
    .from(liveCoachingRecordings as any)
    .where(eq(liveCoachingRecordings.userId, userId));
  const attempts = await dbAny
    .select()
    .from(liveCoachingAttempts as any)
    .where(eq(liveCoachingAttempts.userId, userId));
  const notifications = await dbAny
    .select()
    .from(notificationItems as any)
    .where(eq(notificationItems.userId, userId));
  const feedback = await dbAny
    .select()
    .from(feedbackReports as any)
    .where(eq(feedbackReports.userId, userId));
  const privacy = await dbAny
    .select()
    .from(privacyRequests as any)
    .where(eq(privacyRequests.userId, userId));
  const analytics = await dbAny
    .select()
    .from(analyticsEvents as any)
    .where(eq(analyticsEvents.userId, userId));
  const audit = await dbAny
    .select()
    .from(auditLogs as any)
    .where(eq(auditLogs.userId, userId));

  return {
    userId,
    exportedAt: new Date().toISOString(),
    user: user ?? null,
    settings: settings ?? null,
    sessions: sessionsList,
    liveCoaching: { uploads, recordings, attempts },
    notifications,
    feedback,
    privacyRequests: privacy,
    analyticsEvents: analytics,
    auditLogs: audit,
  };
}

export async function deleteUserData(userId: string): Promise<void> {
  if (useJsonStore) {
    const state = loadJsonDb();
    state.userSettings = state.userSettings.filter((entry) => entry.userId !== userId);
    state.passwordResetTokens = state.passwordResetTokens.filter((entry) => entry.userId !== userId);
    state.userMfaFactors = state.userMfaFactors.filter((entry) => entry.userId !== userId);
    state.auditLogs = state.auditLogs.filter((entry) => entry.userId !== userId);
    state.analyticsEvents = state.analyticsEvents.filter((entry) => entry.userId !== userId);
    state.feedbackReports = state.feedbackReports.filter((entry) => entry.userId !== userId);
    state.notificationItems = state.notificationItems.filter((entry) => entry.userId !== userId);
    state.privacyRequests = state.privacyRequests.filter((entry) => entry.userId !== userId);
    saveJsonDb(state);
    return;
  }
  const dbAny = db as any;
  await dbAny.delete(notificationItems as any).where(eq(notificationItems.userId, userId));
  await dbAny.delete(feedbackReports as any).where(eq(feedbackReports.userId, userId));
  await dbAny.delete(analyticsEvents as any).where(eq(analyticsEvents.userId, userId));
  await dbAny.delete(auditLogs as any).where(eq(auditLogs.userId, userId));
  await dbAny.delete(privacyRequests as any).where(eq(privacyRequests.userId, userId));
  await dbAny.delete(passwordResetTokens as any).where(eq(passwordResetTokens.userId, userId));
  await dbAny.delete(userMfaFactors as any).where(eq(userMfaFactors.userId, userId));
  await dbAny.delete(userSettings as any).where(eq(userSettings.userId, userId));
  await dbAny.delete(liveCoachingAttempts as any).where(eq(liveCoachingAttempts.userId, userId));
  await dbAny.delete(liveCoachingRecordings as any).where(eq(liveCoachingRecordings.userId, userId));
  await dbAny.delete(liveCoachingUploads as any).where(eq(liveCoachingUploads.userId, userId));
  await dbAny.delete(singingSessions as any).where(eq(singingSessions.userId, userId));
  await dbAny.delete(localCredentials as any).where(eq(localCredentials.userId, userId));
  await dbAny.delete(users as any).where(eq(users.id, userId));
}

export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");
