import crypto from "crypto";
import type { Express, Request, RequestHandler } from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { authStorage } from "./replit_integrations/auth";
import { localCredentials } from "@shared/schema";
import { DrizzleSessionStore } from "./drizzleSessionStore";
import {
  addAuditLog,
  addNotification,
  createPasswordResetToken,
  getUserMfa,
  hashToken,
  upsertUserMfa,
  consumePasswordResetToken,
} from "./platformStore";
import { appConfig, featureEnabled } from "./config";
import { authRateLimiter } from "./middleware/security";

const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const isDesktopRuntime = (): boolean => process.env.DESKTOP_APP === "1";
const isProductionRuntime = (): boolean => process.env.NODE_ENV === "production";

const getSessionCookiePolicy = () => {
  const isDesktop = isDesktopRuntime();
  const isProd = isProductionRuntime();
  return {
    isDesktop,
    secure: !isDesktop && isProd,
    sameSite: "lax" as const,
  };
};

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

const signupSchema = loginSchema.extend({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
});

const requestResetSchema = z.object({
  email: z.string().trim().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128),
});

const mfaCodeSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "MFA code must be a 6-digit number"),
});

const mfaLoginSchema = z.object({
  token: z.string().trim().min(6).max(64),
});

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const toBase32 = (buffer: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += base32Alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += base32Alphabet[(value << (5 - bits)) & 31];
  }
  return output;
};

const fromBase32 = (value: string): Buffer => {
  const cleaned = value.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const index = base32Alphabet.indexOf(char);
    if (index === -1) continue;
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
};

const hotp = (secret: string, counter: number): string => {
  const key = fromBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
};

const verifyTotp = (secret: string, token: string, window = 1): boolean => {
  const normalized = token.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const nowWindow = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i += 1) {
    if (hotp(secret, nowWindow + i) === normalized) {
      return true;
    }
  }
  return false;
};

const buildOtpAuthUri = (email: string, secret: string): string => {
  const issuer = encodeURIComponent("SingBetter AI");
  const label = encodeURIComponent(`SingBetter:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
};

const generateRecoveryCodes = (): string[] =>
  Array.from({ length: 8 }).map(() => crypto.randomBytes(4).toString("hex").toUpperCase());

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString("hex")): string => {
  const derived = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
};

const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  const left = Buffer.from(hash, "hex");
  const right = Buffer.from(derived, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

let passportConfigured = false;

const configurePassport = (): void => {
  if (passportConfigured) return;

  passport.use(
    "local-password",
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const dbAny = db as any;
          const normalizedEmail = normalizeEmail(email);
          const [credentials] = await dbAny
            .select()
            .from(localCredentials as any)
            .where(eq(localCredentials.email, normalizedEmail))
            .limit(1);
          if (!credentials) {
            done(null, false, { message: "Invalid email or password" });
            return;
          }

          if (!verifyPassword(password, credentials.passwordHash)) {
            done(null, false, { message: "Invalid email or password" });
            return;
          }

          const user = await authStorage.getUser(credentials.userId);
          if (!user) {
            done(null, false, { message: "Invalid email or password" });
            return;
          }

          done(null, { claims: { sub: user.id } });
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );

  passport.serializeUser((user: any, done) => {
    done(null, user?.claims?.sub ?? null);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      if (!id) {
        done(null, false);
        return;
      }
      const user = await authStorage.getUser(id);
      if (!user) {
        done(null, false);
        return;
      }
      done(null, { claims: { sub: user.id } });
    } catch (error) {
      done(error as Error);
    }
  });

  passportConfigured = true;
};

const loginUser = async (req: Request, userId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    req.logIn({ claims: { sub: userId } }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

const regenerateSession = async (req: Request): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const logoutUser = async (req: Request): Promise<void> =>
  new Promise((resolve) => {
    req.logout(() => {
      const activeSession = req.session;
      if (!activeSession) {
        resolve();
        return;
      }
      activeSession.destroy(() => resolve());
    });
  });

export const setupLocalPasswordAuth = async (app: Express): Promise<void> => {
  if (!db) {
    throw new Error("DATABASE_URL must be set when local password auth is enabled");
  }

  const sessionSecret =
    process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "local-dev-session-secret-change-me");

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required in production");
  }

  const sessionOptions = createSessionOptions({
    secret: sessionSecret,
    ttlMs: sessionTtlMs,
  });
  const cookieOptions = sessionOptions.cookie ?? {};
  console.log(
    JSON.stringify({
      level: "info",
      event: "auth.session.config",
      isDesktop: process.env.DESKTOP_APP === "1",
      nodeEnv: process.env.NODE_ENV ?? "development",
      cookieSecure: cookieOptions.secure ?? false,
      sameSite: cookieOptions.sameSite ?? "lax",
    }),
  );

  app.set("trust proxy", appConfig.trustProxy);
  app.use(session(sessionOptions));

  configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());
};

export const createSessionOptions = (options: {
  secret: string;
  ttlMs: number;
}): session.SessionOptions => {
  const sessionPolicy = getSessionCookiePolicy();
  return {
    secret: options.secret,
    store: new DrizzleSessionStore(options.ttlMs),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: appConfig.releaseMode && !sessionPolicy.isDesktop,
    cookie: {
      httpOnly: true,
      sameSite: sessionPolicy.sameSite,
      secure: sessionPolicy.secure,
      maxAge: options.ttlMs,
    },
  };
};

export const localPasswordIsAuthenticated: RequestHandler = (req, res, next) => {
  const user = req.user as any;
  if (!req.isAuthenticated() || !user?.claims?.sub) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  next();
};

export const getLocalPasswordUserId = (req: Request): string => {
  const userId = (req.user as any)?.claims?.sub;
  if (!userId) {
    throw new Error("Authenticated user is missing");
  }
  return userId;
};

export const registerLocalPasswordAuthRoutes = (app: Express): void => {
  app.get("/api/login", (_req, res) => {
    res.redirect("/login");
  });

  app.post("/api/auth/login", authRateLimiter, (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid login payload" });
      return;
    }

    req.body.email = normalizeEmail(parsed.data.email);
    req.body.password = parsed.data.password;

    passport.authenticate("local-password", async (err: unknown, user: any, info: any) => {
      if (err) {
        next(err);
        return;
      }
      if (!user?.claims?.sub) {
        res.status(401).json({ message: info?.message ?? "Invalid email or password" });
        return;
      }
      try {
        const userId = user.claims.sub as string;
        const mfaRecord = await getUserMfa(userId);
        const mfaEnabled = featureEnabled("mfa") && !!mfaRecord?.enabled;
        if (mfaEnabled) {
          (req.session as any).pendingMfaUserId = userId;
          res.status(202).json({ mfaRequired: true });
          return;
        }

        await regenerateSession(req);
        await loginUser(req, userId);
        const dbUser = await authStorage.getUser(userId);
        await addAuditLog({
          userId,
          action: "auth.login.success",
          resource: "auth",
          ip: req.ip,
          userAgent: req.headers["user-agent"]?.toString(),
        });
        res.json(dbUser ?? null);
      } catch (loginErr) {
        next(loginErr);
      }
    })(req, res, next);
  });

  app.post("/api/auth/signup", authRateLimiter, async (req, res, next) => {
    try {
      const parsed = signupSchema.parse(req.body);
      const normalizedEmail = normalizeEmail(parsed.email);
      const dbAny = db as any;

      const [existing] = await dbAny
        .select()
        .from(localCredentials as any)
        .where(eq(localCredentials.email, normalizedEmail))
        .limit(1);
      if (existing) {
        res.status(409).json({ message: "Email already in use" });
        return;
      }

      const userId = crypto.randomUUID();
      const user = await authStorage.upsertUser({
        id: userId,
        email: normalizedEmail,
        firstName: parsed.firstName ?? null,
        lastName: parsed.lastName ?? null,
        profileImageUrl: null,
      } as any);

      await dbAny.insert(localCredentials as any).values({
        userId: user.id,
        email: normalizedEmail,
        passwordHash: hashPassword(parsed.password),
        updatedAt: new Date(),
      });

      await regenerateSession(req);
      await loginUser(req, user.id);
      await addNotification({
        userId: user.id,
        type: "welcome",
        title: "Welcome to SingBetter",
        body: "Your account is ready. Start a live coaching session to build your first streak.",
      });
      await addAuditLog({
        userId: user.id,
        action: "auth.signup.success",
        resource: "auth",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });
      res.status(201).json(user);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid signup payload" });
        return;
      }
      next(error);
    }
  });

  app.get("/api/auth/user", localPasswordIsAuthenticated, async (req, res, next) => {
    try {
      const userId = getLocalPasswordUserId(req);
      const user = await authStorage.getUser(userId);
      res.json(user ?? null);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/mfa/login/verify", authRateLimiter, async (req, res) => {
    if (!featureEnabled("mfa")) {
      res.status(400).json({ message: "MFA is not enabled" });
      return;
    }
    const parsed = mfaLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid MFA payload" });
      return;
    }
    const pendingUserId = (req.session as any)?.pendingMfaUserId;
    if (!pendingUserId) {
      res.status(401).json({ message: "No MFA challenge is active" });
      return;
    }
    const mfa = await getUserMfa(pendingUserId);
    if (!mfa?.enabled || !mfa.secret) {
      res.status(401).json({ message: "MFA is not configured for this account" });
      return;
    }
    const inputToken = parsed.data.token.trim().toUpperCase();
    let valid = verifyTotp(mfa.secret, inputToken);
    const recoveryCodes = Array.isArray(mfa.recoveryCodes) ? [...mfa.recoveryCodes] : [];

    if (!valid) {
      const recoveryMatchIndex = recoveryCodes.findIndex((code) => code === inputToken);
      if (recoveryMatchIndex >= 0) {
        recoveryCodes.splice(recoveryMatchIndex, 1);
        await upsertUserMfa(pendingUserId, mfa.secret, true, recoveryCodes);
        valid = true;
      }
    }

    if (!valid) {
      res.status(401).json({ message: "Invalid MFA code" });
      return;
    }

    await regenerateSession(req);
    await loginUser(req, pendingUserId);
    const loggedIn = await authStorage.getUser(pendingUserId);
    await addAuditLog({
      userId: pendingUserId,
      action: "auth.mfa.login.success",
      resource: "auth",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
    });
    res.json(loggedIn ?? null);
  });

  app.post("/api/auth/mfa/setup", localPasswordIsAuthenticated, async (req, res) => {
    if (!featureEnabled("mfa")) {
      res.status(400).json({ message: "MFA is not enabled" });
      return;
    }
    const userId = getLocalPasswordUserId(req);
    const user = await authStorage.getUser(userId);
    const email = user?.email || `${userId}@example.local`;
    const secret = toBase32(crypto.randomBytes(20));
    const recoveryCodes = generateRecoveryCodes();
    await upsertUserMfa(userId, secret, false, recoveryCodes);
    await addAuditLog({
      userId,
      action: "auth.mfa.setup.initiated",
      resource: "mfa",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
    });
    res.json({
      secret,
      otpauthUrl: buildOtpAuthUri(email, secret),
      recoveryCodes,
    });
  });

  app.post("/api/auth/mfa/verify", localPasswordIsAuthenticated, async (req, res) => {
    if (!featureEnabled("mfa")) {
      res.status(400).json({ message: "MFA is not enabled" });
      return;
    }
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid MFA code" });
      return;
    }
    const userId = getLocalPasswordUserId(req);
    const mfa = await getUserMfa(userId);
    if (!mfa?.secret) {
      res.status(404).json({ message: "MFA is not configured" });
      return;
    }
    if (!verifyTotp(mfa.secret, parsed.data.token)) {
      res.status(401).json({ message: "Invalid MFA code" });
      return;
    }
    await upsertUserMfa(userId, mfa.secret, true, Array.isArray(mfa.recoveryCodes) ? mfa.recoveryCodes : []);
    await addAuditLog({
      userId,
      action: "auth.mfa.enabled",
      resource: "mfa",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
    });
    res.json({ enabled: true });
  });

  app.get("/api/auth/mfa/status", localPasswordIsAuthenticated, async (req, res) => {
    const userId = getLocalPasswordUserId(req);
    const mfa = await getUserMfa(userId);
    res.json({
      enabled: !!mfa?.enabled,
      recoveryCodesRemaining: Array.isArray(mfa?.recoveryCodes) ? mfa!.recoveryCodes.length : 0,
      featureEnabled: featureEnabled("mfa"),
    });
  });

  app.post("/api/auth/mfa/disable", localPasswordIsAuthenticated, async (req, res) => {
    const parsed = mfaCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.errors[0]?.message ?? "Invalid MFA code" });
      return;
    }
    const userId = getLocalPasswordUserId(req);
    const mfa = await getUserMfa(userId);
    if (!mfa?.enabled || !mfa.secret) {
      res.status(404).json({ message: "MFA is not enabled" });
      return;
    }
    if (!verifyTotp(mfa.secret, parsed.data.token)) {
      res.status(401).json({ message: "Invalid MFA code" });
      return;
    }
    await upsertUserMfa(userId, mfa.secret, false, []);
    await addAuditLog({
      userId,
      action: "auth.mfa.disabled",
      resource: "mfa",
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.toString(),
    });
    res.json({ enabled: false });
  });

  app.post("/api/auth/password/request-reset", authRateLimiter, async (req, res, next) => {
    try {
      const parsed = requestResetSchema.parse(req.body);
      const dbAny = db as any;
      const email = normalizeEmail(parsed.email);
      const [credentials] = await dbAny
        .select()
        .from(localCredentials as any)
        .where(eq(localCredentials.email, email))
        .limit(1);

      if (credentials?.userId) {
        const rawToken = crypto.randomBytes(24).toString("hex");
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        await createPasswordResetToken(credentials.userId, tokenHash, expiresAt);
        await addAuditLog({
          userId: credentials.userId,
          action: "auth.password_reset.requested",
          resource: "auth",
          ip: req.ip,
          userAgent: req.headers["user-agent"]?.toString(),
        });

        if (!appConfig.isProd) {
          res.json({
            message: "Password reset token generated",
            resetToken: rawToken,
            expiresAt,
          });
          return;
        }
      }

      res.status(204).end();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid request" });
        return;
      }
      next(error);
    }
  });

  app.post("/api/auth/password/reset", authRateLimiter, async (req, res, next) => {
    try {
      const parsed = resetPasswordSchema.parse(req.body);
      const tokenHash = hashToken(parsed.token);
      const userId = await consumePasswordResetToken(tokenHash);
      if (!userId) {
        res.status(400).json({ message: "Reset token is invalid or expired" });
        return;
      }
      const dbAny = db as any;
      await dbAny
        .update(localCredentials as any)
        .set({
          passwordHash: hashPassword(parsed.newPassword),
          updatedAt: new Date(),
        })
        .where(eq(localCredentials.userId, userId));

      await addAuditLog({
        userId,
        action: "auth.password_reset.completed",
        resource: "auth",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });
      await addNotification({
        userId,
        type: "security",
        title: "Password updated",
        body: "Your account password was successfully reset.",
      });

      res.status(204).end();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: error.errors[0]?.message ?? "Invalid reset payload" });
        return;
      }
      next(error);
    }
  });

  app.post(
    "/api/auth/session/rotate",
    authRateLimiter,
    localPasswordIsAuthenticated,
    async (req, res, next) => {
    try {
      const userId = getLocalPasswordUserId(req);
      await regenerateSession(req);
      await loginUser(req, userId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
    },
  );

  app.post("/api/auth/logout", async (req, res) => {
    const userId = (req.user as any)?.claims?.sub as string | undefined;
    await logoutUser(req);
    if (userId) {
      await addAuditLog({
        userId,
        action: "auth.logout",
        resource: "auth",
        ip: req.ip,
        userAgent: req.headers["user-agent"]?.toString(),
      });
    }
    res.status(204).end();
  });

  app.get("/api/logout", async (req, res) => {
    await logoutUser(req);
    res.redirect("/");
  });
};
