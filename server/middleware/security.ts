import type { Request, RequestHandler, Response } from "express";
import { appConfig } from "../config";

type Bucket = {
  resetAt: number;
  count: number;
};

const ipBuckets = new Map<string, Bucket>();

const getClientIp = (req: Request): string =>
  req.ip || req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";

const hitRateLimit = (key: string, maxRequests: number, windowMs: number): boolean => {
  const current = Date.now();
  const existing = ipBuckets.get(key);
  if (!existing || existing.resetAt <= current) {
    ipBuckets.set(key, { count: 1, resetAt: current + windowMs });
    return false;
  }
  existing.count += 1;
  ipBuckets.set(key, existing);
  return existing.count > maxRequests;
};

const setRateLimitHeaders = (res: Response, maxRequests: number, remaining: number): void => {
  res.setHeader("x-ratelimit-limit", String(maxRequests));
  res.setHeader("x-ratelimit-remaining", String(Math.max(0, remaining)));
};

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const secureHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-permitted-cross-domain-policies", "none");
  res.setHeader("permissions-policy", "camera=(), microphone=(self), geolocation=()");
  if (appConfig.isProd) {
    res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
};

export const createRateLimiter = (maxRequests: number): RequestHandler => {
  const windowMs = appConfig.rateLimit.windowMs;
  return (req, res, next) => {
    if (appConfig.isTest) return next();
    const ip = getClientIp(req);
    const key = `${ip}:${req.baseUrl || ""}:${req.path}`;
    const blocked = hitRateLimit(key, maxRequests, windowMs);
    const bucket = ipBuckets.get(key);
    const remaining = bucket ? maxRequests - bucket.count : maxRequests;
    setRateLimitHeaders(res, maxRequests, remaining);
    if (blocked) {
      res.status(429).json({
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again shortly.",
      });
      return;
    }
    next();
  };
};

export const globalRateLimiter = createRateLimiter(appConfig.rateLimit.maxRequests);
export const authRateLimiter = createRateLimiter(appConfig.rateLimit.authMaxRequests);

export const contentTypeGuard: RequestHandler = (req, res, next) => {
  if (!stateChangingMethods.has(req.method)) return next();
  if (!req.path.startsWith("/api/")) return next();

  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    return next();
  }

  if (
    req.is("application/json") ||
    req.is("application/x-www-form-urlencoded") ||
    req.is("multipart/form-data")
  ) {
    return next();
  }

  res.status(415).json({
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Unsupported content type for this endpoint",
  });
};
