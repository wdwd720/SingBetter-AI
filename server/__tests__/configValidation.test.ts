import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
};

const setReleaseEnvBase = () => {
  process.env.NODE_ENV = "production";
  process.env.RELEASE_MODE = "true";
  process.env.DISABLE_AUTH = "false";
  process.env.SESSION_SECRET = "super-secure-session-secret-value-12345";
  process.env.UPLOADS_DRIVER = "s3";
  process.env.UPLOAD_SCAN_MODE = "strict";
  process.env.TRUST_PROXY = "1";
  process.env.TRANSCRIPTION_ENABLED = "false";
};

describe("launch config validation", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("fails in release mode when auth bypass is enabled", async () => {
    setReleaseEnvBase();
    process.env.DISABLE_AUTH = "true";

    await expect(import("../config")).rejects.toThrow(
      /DISABLE_AUTH cannot be true/i,
    );
  });

  it("fails in release mode when session secret is weak", async () => {
    setReleaseEnvBase();
    process.env.SESSION_SECRET = "change-me";

    await expect(import("../config")).rejects.toThrow(/SESSION_SECRET/i);
  });

  it("allows valid release configuration", async () => {
    setReleaseEnvBase();

    const { appConfig } = await import("../config");
    expect(appConfig.releaseMode).toBe(true);
    expect(appConfig.authDisabled).toBe(false);
    expect(appConfig.uploads.driver).toBe("s3");
  });
});
