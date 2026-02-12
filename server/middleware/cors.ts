import type { Request, RequestHandler } from "express";
import { appConfig } from "../config";

const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const appendVary = (existing: string | number | string[] | undefined): string => {
  if (!existing) return "Origin";
  const value = Array.isArray(existing) ? existing.join(", ") : String(existing);
  if (/(\b|,\s*)origin(\b|,\s*)/i.test(value)) return value;
  return `${value}, Origin`;
};

const resolveRequestOrigin = (req: Request): string => {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http")
    .toString()
    .split(",")[0]
    .trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "")
    .toString()
    .split(",")[0]
    .trim();
  return `${proto}://${host}`.toLowerCase();
};

const isAllowedOrigin = (req: Request, origin: string): boolean => {
  const normalized = origin.toLowerCase();
  if (normalized === resolveRequestOrigin(req)) return true;

  if (appConfig.isDev || appConfig.isTest) {
    return localhostPattern.test(origin);
  }

  return appConfig.corsAllowedOrigins.some(
    (allowed) => allowed.toLowerCase() === normalized,
  );
};

export const corsPolicy: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();

  if (!isAllowedOrigin(req, origin)) {
    if (req.path.startsWith("/api/")) {
      res.status(403).json({
        code: "CORS_ORIGIN_BLOCKED",
        message: "Origin is not allowed by CORS policy",
      });
      return;
    }
    return next();
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-CSRF-Token, X-Requested-With, X-Metrics-Token",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Vary", appendVary(res.getHeader("Vary")));

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
};
