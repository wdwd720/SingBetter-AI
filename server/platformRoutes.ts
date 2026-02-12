import type { Express, Request, RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { authStorage } from "./replit_integrations/auth";
import { appConfig, featureEnabled } from "./config";
import {
  addAnalyticsEvent,
  addAuditLog,
  addFeedbackReport,
  addNotification,
  createPrivacyRequest,
  deleteUserData,
  exportUserData,
  getOrCreateUserSettings,
  listNotifications,
  markNotificationRead,
  updateUserSettings,
} from "./platformStore";
import { healthResponse, metricsResponse } from "./observability";
import { enqueueJob, listJobs } from "./queue";

type GetUserId = (req: Request) => string;

const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  profileImageUrl: z.string().url().nullable().optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  emailNotifications: z.boolean().optional(),
  inAppNotifications: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
});

const feedbackSchema = z.object({
  category: z.enum(["bug", "feature", "support", "other"]).default("other"),
  message: z.string().trim().min(10).max(4000),
});

const analyticsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  properties: z.record(z.any()).optional(),
});

const consentSchema = z
  .object({
    granted: z.boolean().default(true),
    version: z.string().trim().max(40).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.granted && !value.version) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Version is required when granting consent",
        path: ["version"],
      });
    }
  });

const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE"),
});

const adminNotificationSchema = z.object({
  userId: z.string().trim().min(1),
  type: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(1500).optional(),
});

const isAdmin = async (userId: string): Promise<boolean> => {
  const settings = await getOrCreateUserSettings(userId);
  return settings.role === "admin";
};

const requireAdmin = (getUserId: GetUserId): RequestHandler => async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!(await isAdmin(userId))) {
      res.status(403).json({ code: "FORBIDDEN", message: "Admin role required" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export function registerPlatformRoutes(
  app: Express,
  requireAuth: RequestHandler,
  getUserId: GetUserId,
): void {
  app.get("/api/openapi.json", (_req, res) => {
    const openapiPath = path.join(process.cwd(), "docs", "openapi.json");
    if (!fs.existsSync(openapiPath)) {
      res.status(404).json({ message: "OpenAPI spec not found" });
      return;
    }
    res.type("application/json").send(fs.readFileSync(openapiPath, "utf8"));
  });

  app.get("/api/health", async (_req, res) => {
    res.json(await healthResponse());
  });

  app.get("/api/feature-flags", (_req, res) => {
    res.json(appConfig.features);
  });

  app.get("/api/metrics", (req, res) => {
    const configuredToken = process.env.METRICS_TOKEN?.trim();
    if (process.env.NODE_ENV === "production" || appConfig.releaseMode) {
      if (!configuredToken) {
        res.status(403).json({ message: "Metrics are disabled until METRICS_TOKEN is configured" });
        return;
      }
      const provided = (req.headers["x-metrics-token"] || "").toString().trim();
      if (!provided || provided !== configuredToken) {
        res.status(401).json({ message: "Invalid metrics token" });
        return;
      }
    }
    res.json(metricsResponse());
  });

  app.get("/api/profile", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserId(req);
      let user = await authStorage.getUser(userId);
      if (!user) {
        user = await authStorage.upsertUser({
          id: userId,
          email: `${userId}@example.local`,
          firstName: "Local",
          lastName: "User",
          profileImageUrl: null,
        } as any);
      }
      const settings = await getOrCreateUserSettings(userId);
      res.json({ user, settings });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/profile", requireAuth, async (req, res, next) => {
    try {
      const parsed = profileUpdateSchema.parse(req.body);
      const userId = getUserId(req);
      const currentUser =
        (await authStorage.getUser(userId)) ??
        (await authStorage.upsertUser({
          id: userId,
          email: `${userId}@example.local`,
          firstName: "Local",
          lastName: "User",
          profileImageUrl: null,
        } as any));

      const user = await authStorage.upsertUser({
        ...currentUser,
        firstName: parsed.firstName ?? currentUser.firstName,
        lastName: parsed.lastName ?? currentUser.lastName,
        profileImageUrl: parsed.profileImageUrl !== undefined ? parsed.profileImageUrl : currentUser.profileImageUrl,
      });

      const settings =
        (await updateUserSettings(userId, {
        locale: parsed.locale,
        emailNotifications: parsed.emailNotifications,
        inAppNotifications: parsed.inAppNotifications,
        onboardingCompletedAt:
          parsed.onboardingCompleted === true ? new Date() : undefined,
      })) ?? (await getOrCreateUserSettings(userId));

      await addAuditLog({
        userId,
        action: "profile.updated",
        resource: "profile",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });

      res.json({
        user,
        settings: {
          ...settings,
          locale: (settings as any)?.locale ?? parsed.locale ?? "en",
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid profile payload" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/privacy/consent", requireAuth, async (req, res, next) => {
    try {
      const parsed = consentSchema.parse(req.body);
      const userId = getUserId(req);

      const granted = parsed.granted !== false;
      const settings = await updateUserSettings(userId, {
        consentVersion: granted ? parsed.version ?? null : null,
        consentGivenAt: granted ? new Date() : null,
      });

      if (granted) {
        await createPrivacyRequest({
          userId,
          requestType: "access",
          payload: { type: "consent", version: parsed.version },
        });
        await addAuditLog({
          userId,
          action: "privacy.consent.accepted",
          resource: "privacy",
          ip: req.ip,
          userAgent: req.headers["user-agent"]?.toString(),
          details: { version: parsed.version },
        });
      } else {
        await addAuditLog({
          userId,
          action: "privacy.consent.withdrawn",
          resource: "privacy",
          ip: req.ip,
          userAgent: req.headers["user-agent"]?.toString(),
        });
      }
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid consent payload" });
        return;
      }
      next(error);
    }
  });

  app.get("/api/privacy/export", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const payload = await exportUserData(userId);
      await createPrivacyRequest({
        userId,
        requestType: "export",
        payload: { exportedAt: new Date().toISOString() },
      });
      await addAuditLog({
        userId,
        action: "privacy.export.requested",
        resource: "privacy",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/privacy/delete-account", requireAuth, async (req, res, next) => {
    try {
      const parsed = deleteAccountSchema.parse(req.body);
      if (parsed.confirm !== "DELETE") {
        res.status(400).json({ message: "Invalid delete confirmation" });
        return;
      }
      const userId = getUserId(req);
      await createPrivacyRequest({
        userId,
        requestType: "delete",
        payload: { requestedAt: new Date().toISOString() },
      });
      await deleteUserData(userId);
      await addAuditLog({
        userId,
        action: "privacy.account.deleted",
        resource: "privacy",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });
      if (typeof (req as any).logout === "function") {
        (req as any).logout(() => {
          req.session?.destroy(() => {
            res.status(204).end();
          });
        });
        return;
      }
      req.session?.destroy(() => {
        res.status(204).end();
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid request" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/feedback", requireAuth, async (req, res, next) => {
    try {
      if (!featureEnabled("feedback")) {
        res.status(202).json({ message: "Feedback feature disabled" });
        return;
      }
      const parsed = feedbackSchema.parse(req.body);
      const userId = getUserId(req);
      const report = await addFeedbackReport({
        userId,
        category: parsed.category,
        message: parsed.message,
      });
      enqueueJob("feedback_reported", {
        userId,
        category: parsed.category,
        reportId: report.id,
      });
      await addAuditLog({
        userId,
        action: "feedback.submitted",
        resource: "feedback",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });
      res.status(201).json(report);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid feedback payload" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/analytics/events", requireAuth, async (req, res, next) => {
    try {
      if (!featureEnabled("analytics")) {
        res.status(202).json({ message: "Analytics feature disabled" });
        return;
      }
      const parsed = analyticsSchema.parse(req.body);
      const userId = getUserId(req);
      const settings = await getOrCreateUserSettings(userId);
      if (!settings.consentGivenAt) {
        res.status(403).json({ message: "Analytics consent required" });
        return;
      }
      const event = await addAnalyticsEvent({
        userId,
        name: parsed.name,
        properties: parsed.properties ?? null,
      });
      res.status(201).json(event);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid analytics payload" });
        return;
      }
      next(error);
    }
  });

  app.get("/api/notifications", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
      const items = await listNotifications(userId, limit);
      res.json(items);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/notifications/:id/read", requireAuth, async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const notificationId = Number(req.params.id);
      if (!Number.isFinite(notificationId)) {
        res.status(400).json({ message: "Invalid notification id" });
        return;
      }
      const updated = await markNotificationRead(userId, notificationId);
      if (!updated) {
        res.status(404).json({ message: "Notification not found" });
        return;
      }
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/notifications", requireAuth, requireAdmin(getUserId), async (req, res, next) => {
    try {
      const parsed = adminNotificationSchema.parse(req.body);
      const created = await addNotification({
        userId: parsed.userId,
        type: parsed.type,
        title: parsed.title,
        body: parsed.body ?? null,
      });
      enqueueJob("notification_created", {
        userId: parsed.userId,
        notificationId: created.id,
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid notification payload" });
        return;
      }
      next(error);
    }
  });

  app.get("/api/admin/audit-logs", requireAuth, requireAdmin(getUserId), async (req, res) => {
    const userId = getUserId(req);
    await addAuditLog({
      userId,
      action: "audit_logs.read",
      resource: "audit",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
    });
    res.status(200).json({ message: "Audit logs are recorded server-side for compliance." });
  });

  app.get("/api/admin/jobs", requireAuth, requireAdmin(getUserId), (_req, res) => {
    res.json(listJobs(100));
  });

  app.get("/api/help/contact", (_req, res) => {
    res.json({
      supportEmail: process.env.SUPPORT_EMAIL || "support@example.com",
      docs: "/help",
    });
  });
}
