import crypto from "crypto";
import type { Request, RequestHandler } from "express";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const readTokenFromRequest = (req: Request): string | undefined => {
  const headerToken =
    req.headers["x-csrf-token"] || req.headers["x-xsrf-token"];
  if (typeof headerToken === "string" && headerToken.trim().length > 0) {
    return headerToken.trim();
  }
  return undefined;
};

const getSession = (req: Request): Record<string, any> | null => {
  const session = (req as any).session;
  if (!session || typeof session !== "object") return null;
  return session as Record<string, any>;
};

const ensureSessionToken = (req: Request): string | null => {
  const session = getSession(req);
  if (!session) return null;
  if (typeof session.csrfToken !== "string" || session.csrfToken.length < 20) {
    session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return session.csrfToken;
};

export const csrfTokenHandler: RequestHandler = (req, res) => {
  const token = ensureSessionToken(req);
  if (!token) {
    res.status(501).json({
      code: "CSRF_SESSION_UNAVAILABLE",
      message: "CSRF is enabled but session storage is unavailable",
    });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ csrfToken: token });
};

export const createCsrfProtection = (options: {
  enabled: boolean;
  exemptPaths?: string[];
}): RequestHandler => {
  const exemptSet = new Set(options.exemptPaths || []);
  return (req, res, next) => {
    if (!options.enabled) return next();
    if (!req.path.startsWith("/api/")) return next();
    if (!stateChangingMethods.has(req.method)) return next();
    if (exemptSet.has(req.path)) return next();

    const expected = ensureSessionToken(req);
    if (!expected) {
      res.status(403).json({
        code: "CSRF_FORBIDDEN",
        message: "CSRF validation failed (session unavailable)",
      });
      return;
    }

    const provided = readTokenFromRequest(req);
    if (!provided || provided !== expected) {
      res.status(403).json({
        code: "CSRF_FORBIDDEN",
        message: "CSRF token is missing or invalid",
      });
      return;
    }

    next();
  };
};
