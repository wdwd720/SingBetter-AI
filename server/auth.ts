import type { Express, RequestHandler } from "express";
import type { User } from "@shared/models/auth";

const truthyValues = new Set(["1", "true", "yes", "on"]);
const authModes = new Set(["replit", "local"]);

export type AuthMode = "disabled" | "replit" | "local";

export function isAuthDisabled(): boolean {
  const rawFlag = process.env.DISABLE_AUTH;
  if (typeof rawFlag === "string" && rawFlag.trim().length > 0) {
    return truthyValues.has(rawFlag.trim().toLowerCase());
  }
  return process.env.NODE_ENV === "development";
}

export function resolveAuthMode(): AuthMode {
  if (isAuthDisabled()) return "disabled";

  const configured = process.env.AUTH_PROVIDER?.trim().toLowerCase();
  if (configured && authModes.has(configured)) {
    return configured as AuthMode;
  }

  return process.env.REPL_ID ? "replit" : "local";
}

export const localUser: User = {
  id: "local-user",
  email: "local@example.com",
  firstName: "Local",
  lastName: "User",
  profileImageUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const localAuthMiddleware: RequestHandler = (req, _res, next) => {
  (req as any).user = {
    claims: { sub: localUser.id },
  };
  (req as any).isAuthenticated = () => true;
  next();
};

export function registerLocalAuthRoutes(app: Express): void {
  app.get("/api/auth/user", (_req, res) => {
    res.json(localUser);
  });

  app.get("/api/login", (_req, res) => {
    res.redirect("/");
  });

  app.get("/api/callback", (_req, res) => {
    res.redirect("/");
  });

  app.get("/api/logout", (_req, res) => {
    res.redirect("/");
  });
}
