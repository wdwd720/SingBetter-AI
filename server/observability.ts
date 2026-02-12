import type { Request, RequestHandler } from "express";
import { appConfig } from "./config";
import { isAuthDisabled, resolveAuthMode } from "./auth";
import { getDatabaseStatus } from "./db";
import { getUploadStorageStatus } from "./uploadStorage";
import { getJobRunnerStatus } from "./jobs";
import { getQueueStatus } from "./queue";

type RouteStats = {
  count: number;
  errors: number;
  totalDurationMs: number;
  p95Samples: number[];
};

const startedAt = Date.now();
const routes = new Map<string, RouteStats>();

const getKey = (req: Request): string => `${req.method} ${req.path}`;

const getOrInit = (key: string): RouteStats => {
  const current = routes.get(key);
  if (current) return current;
  const created: RouteStats = { count: 0, errors: 0, totalDurationMs: 0, p95Samples: [] };
  routes.set(key, created);
  return created;
};

const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
};

export const requestMetricsMiddleware: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const key = getKey(req);
    const stats = getOrInit(key);
    const duration = Date.now() - start;
    stats.count += 1;
    stats.totalDurationMs += duration;
    stats.p95Samples.push(duration);
    if (stats.p95Samples.length > 500) {
      stats.p95Samples.shift();
    }
    if (res.statusCode >= 500) {
      stats.errors += 1;
    }
  });
  next();
};

export const healthResponse = async () => {
  const db = await getDatabaseStatus();
  const storage = getUploadStorageStatus();
  const jobs = getJobRunnerStatus();
  const queue = getQueueStatus();
  const ready = db.healthy && storage.healthy && jobs.started;

  return {
    status: ready ? "ok" : "degraded",
    readiness: ready ? "ready" : "degraded",
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    mode: {
      environment: appConfig.env,
      releaseMode: appConfig.releaseMode,
      authMode: resolveAuthMode(),
      devMode: isAuthDisabled(),
    },
    db,
    storage,
    jobs,
    queue,
    build: {
      version: appConfig.version,
      commitSha: appConfig.commitSha,
    },
  };
};

export const metricsResponse = () => ({
  generatedAt: new Date().toISOString(),
  uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  routes: Array.from(routes.entries()).map(([route, stats]) => ({
    route,
    requests: stats.count,
    errors: stats.errors,
    avgDurationMs: stats.count ? Math.round(stats.totalDurationMs / stats.count) : 0,
    p95DurationMs: Math.round(percentile(stats.p95Samples, 95)),
  })),
});
