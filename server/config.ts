import { z } from "zod";

const boolLike = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return false;
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  });

const weakSecrets = new Set([
  "change-me",
  "changeme",
  "secret",
  "default",
  "password",
  "replace-with-strong-secret",
  "replace-with-very-strong-secret",
]);

type TrustProxyValue = boolean | number | string;

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().optional(),
  HOST: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  AUTH_PROVIDER: z.string().optional(),
  DISABLE_AUTH: boolLike,
  RELEASE_MODE: boolLike,
  CSRF_ENABLED: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  USE_JSON_DB: boolLike,
  TRUST_PROXY: z.string().optional(),
  UPLOADS_DRIVER: z.string().optional(),
  UPLOAD_SCAN_MODE: z.string().optional(),
  ALLOW_LOCAL_UPLOADS_IN_PROD: boolLike,
  ASSEMBLYAI_API_KEY: z.string().optional(),
  TRANSCRIPTION_ENABLED: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  APP_VERSION: z.string().optional(),
  APP_COMMIT_SHA: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  FEATURE_ONBOARDING: boolLike,
  FEATURE_ANALYTICS: boolLike,
  FEATURE_NOTIFICATIONS: boolLike,
  FEATURE_MFA: boolLike,
  FEATURE_LOCALIZATION: boolLike,
  FEATURE_FEEDBACK: boolLike,
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(120),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().default(20),
  RATE_LIMIT_EXPENSIVE_MAX: z.coerce.number().default(12),
  API_DOCS_ENABLED: boolLike,
  RETENTION_DAYS_AUDIT: z.coerce.number().default(90),
  RETENTION_DAYS_ANALYTICS: z.coerce.number().default(30),
  SUPPORT_EMAIL: z.string().email().optional(),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment configuration: ${issues.join(", ")}`);
}

const env = parsed.data;

const parseBool = (rawValue: string | undefined, fallback: boolean): boolean => {
  if (typeof rawValue !== "string") return fallback;
  return ["1", "true", "yes", "on"].includes(rawValue.trim().toLowerCase());
};

const parseTrustProxy = (
  rawValue: string | undefined,
  releaseMode: boolean,
): TrustProxyValue => {
  if (!rawValue || rawValue.trim().length === 0) {
    return releaseMode ? 1 : false;
  }
  const normalized = rawValue.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "yes", "on"].includes(normalized)) return 1;
  const asNumber = Number(rawValue);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return rawValue.trim();
};

const splitCsv = (value: string | undefined): string[] =>
  typeof value === "string" && value.trim().length > 0
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const readFeature = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
};

const releaseMode = env.NODE_ENV === "production" || !!env.RELEASE_MODE;
const authDisabled =
  typeof process.env.DISABLE_AUTH === "string"
    ? ["1", "true", "yes", "on"].includes(
        process.env.DISABLE_AUTH.trim().toLowerCase(),
      )
    : env.NODE_ENV === "development";
const uploadDriver = (env.UPLOADS_DRIVER || "local").trim().toLowerCase();
const uploadScanMode = (env.UPLOAD_SCAN_MODE || "basic").trim().toLowerCase();
const trustProxy = parseTrustProxy(env.TRUST_PROXY, releaseMode);
const transcriptionEnabled = parseBool(
  env.TRANSCRIPTION_ENABLED,
  !!env.ASSEMBLYAI_API_KEY,
);
const csrfEnabled = parseBool(env.CSRF_ENABLED, !authDisabled);

const configErrors: string[] = [];
if (releaseMode) {
  if (authDisabled) {
    configErrors.push(
      "DISABLE_AUTH cannot be true in production/release mode.",
    );
  }

  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.length < 24) {
    configErrors.push(
      "SESSION_SECRET must be set with at least 24 characters in production/release mode.",
    );
  } else if (weakSecrets.has(sessionSecret.toLowerCase())) {
    configErrors.push("SESSION_SECRET is too weak for production/release mode.");
  }

  if (!env.UPLOADS_DRIVER || env.UPLOADS_DRIVER.trim().length === 0) {
    configErrors.push(
      "UPLOADS_DRIVER must be explicitly set in production/release mode.",
    );
  }

  if (uploadDriver === "local" && !env.ALLOW_LOCAL_UPLOADS_IN_PROD) {
    configErrors.push(
      "UPLOADS_DRIVER=local requires ALLOW_LOCAL_UPLOADS_IN_PROD=true in production/release mode.",
    );
  }

  if (uploadScanMode === "off") {
    configErrors.push(
      "UPLOAD_SCAN_MODE=off is not allowed in production/release mode.",
    );
  }

  if (transcriptionEnabled && !env.ASSEMBLYAI_API_KEY) {
    configErrors.push(
      "ASSEMBLYAI_API_KEY must be set when TRANSCRIPTION_ENABLED is true in production/release mode.",
    );
  }

  if (trustProxy === false || trustProxy === 0) {
    configErrors.push(
      "TRUST_PROXY must be enabled in production/release mode to support secure cookies behind reverse proxy.",
    );
  }
}

if (configErrors.length > 0) {
  throw new Error(
    `Invalid launch configuration:\n- ${configErrors.join("\n- ")}`,
  );
}

export const appConfig = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === "production",
  isDev: env.NODE_ENV === "development",
  isTest: env.NODE_ENV === "test",
  releaseMode,
  authDisabled,
  host: env.HOST,
  port: env.PORT ? Number(env.PORT) : 5000,
  trustProxy,
  version: env.APP_VERSION || process.env.npm_package_version || "0.0.0",
  commitSha:
    env.APP_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "unknown",
  supportEmail: env.SUPPORT_EMAIL || "support@example.com",
  corsAllowedOrigins: splitCsv(env.CORS_ALLOWED_ORIGINS),
  features: {
    onboarding: readFeature("FEATURE_ONBOARDING", true),
    analytics: readFeature("FEATURE_ANALYTICS", true),
    notifications: readFeature("FEATURE_NOTIFICATIONS", true),
    mfa: readFeature("FEATURE_MFA", true),
    localization: readFeature("FEATURE_LOCALIZATION", true),
    feedback: readFeature("FEATURE_FEEDBACK", true),
    apiDocs: readFeature("API_DOCS_ENABLED", true),
  },
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
    authMaxRequests: env.RATE_LIMIT_AUTH_MAX,
    expensiveMaxRequests: env.RATE_LIMIT_EXPENSIVE_MAX,
  },
  csrf: {
    enabled: csrfEnabled,
  },
  uploads: {
    driver: uploadDriver,
    scanMode: uploadScanMode,
    allowLocalInProd: !!env.ALLOW_LOCAL_UPLOADS_IN_PROD,
  },
  transcription: {
    enabled: transcriptionEnabled,
  },
  sentry: {
    dsn: env.SENTRY_DSN,
  },
  retention: {
    auditDays: env.RETENTION_DAYS_AUDIT,
    analyticsDays: env.RETENTION_DAYS_ANALYTICS,
  },
} as const;

export const featureEnabled = (name: keyof typeof appConfig.features): boolean =>
  !!appConfig.features[name];
