import { appConfig } from "../config";

type SentryModule = {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
};

let sentry: SentryModule | null = null;
let initialized = false;

export const initSentry = async () => {
  if (initialized) return;
  initialized = true;

  const dsn = appConfig.sentry.dsn?.trim();
  if (!dsn) return;

  try {
    const imported = await import("@sentry/node");
    sentry = imported as unknown as SentryModule;
    sentry.init({
      dsn,
      environment: appConfig.env,
      release: `${appConfig.version}+${appConfig.commitSha}`,
    });
    console.log(
      JSON.stringify({
        level: "info",
        event: "sentry.init",
        enabled: true,
      }),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "sentry.init_failed",
        message:
          error instanceof Error ? error.message : "Failed to initialize Sentry",
      }),
    );
  }
};

export const captureSentryException = (
  error: unknown,
  context?: Record<string, unknown>,
) => {
  if (!sentry) return;
  try {
    sentry.captureException(error, context);
  } catch {
    // Best-effort reporting.
  }
};

export const isSentryEnabled = () => !!sentry;
