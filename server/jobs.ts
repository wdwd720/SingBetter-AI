import { lt } from "drizzle-orm";
import { appConfig } from "./config";
import { db } from "./db";
import { analyticsEvents, auditLogs } from "@shared/schema";
import { purgeExpiredPasswordResetTokens } from "./platformStore";

let started = false;

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const cleanupRetentionData = async (): Promise<void> => {
  if (!db) return;
  const dbAny = db as any;
  await dbAny
    .delete(analyticsEvents as any)
    .where(lt(analyticsEvents.createdAt as any, daysAgo(appConfig.retention.analyticsDays)));
  await dbAny
    .delete(auditLogs as any)
    .where(lt(auditLogs.createdAt as any, daysAgo(appConfig.retention.auditDays)));
};

export const startBackgroundJobs = () => {
  if (started) return;
  started = true;

  const run = async () => {
    await purgeExpiredPasswordResetTokens();
    await cleanupRetentionData();
  };

  void run();
  const timer = setInterval(() => {
    void run();
  }, 10 * 60 * 1000);
  timer.unref?.();
};

export const getJobRunnerStatus = () => ({
  started,
  intervalMs: 10 * 60 * 1000,
});
