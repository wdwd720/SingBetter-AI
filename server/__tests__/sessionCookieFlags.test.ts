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

describe("session cookie launch flags", () => {
  afterEach(() => {
    restoreEnv();
    vi.resetModules();
  });

  it("enables secure cookies and proxy mode in release config", async () => {
    process.env.NODE_ENV = "production";
    process.env.RELEASE_MODE = "true";
    process.env.DISABLE_AUTH = "false";
    process.env.SESSION_SECRET = "super-secure-session-secret-value-12345";
    process.env.UPLOADS_DRIVER = "s3";
    process.env.UPLOAD_SCAN_MODE = "strict";
    process.env.TRUST_PROXY = "1";
    process.env.TRANSCRIPTION_ENABLED = "false";
    process.env.DATABASE_URL = "sqlite::memory:";

    const { createSessionOptions } = await import("../localPasswordAuth");
    const options = createSessionOptions({
      secret: "another-super-secure-secret-value-12345",
      ttlMs: 60_000,
    });

    expect(options.proxy).toBe(true);
    expect(options.cookie?.httpOnly).toBe(true);
    expect(options.cookie?.sameSite).toBe("lax");
    expect(options.cookie?.secure).toBe(true);
    expect(options.cookie?.maxAge).toBe(60_000);
  });

  it("keeps secure cookie flag off in development", async () => {
    process.env.NODE_ENV = "development";
    process.env.DISABLE_AUTH = "true";
    process.env.DATABASE_URL = "sqlite::memory:";

    const { createSessionOptions } = await import("../localPasswordAuth");
    const options = createSessionOptions({
      secret: "dev-secret-with-length-123456",
      ttlMs: 30_000,
    });

    expect(options.proxy).toBe(false);
    expect(options.cookie?.secure).toBe(false);
    expect(options.cookie?.httpOnly).toBe(true);
  });

  it("disables secure cookies for desktop app runtime on localhost", async () => {
    process.env.NODE_ENV = "production";
    process.env.RELEASE_MODE = "true";
    process.env.DESKTOP_APP = "1";
    process.env.DISABLE_AUTH = "false";
    process.env.SESSION_SECRET = "super-secure-session-secret-value-12345";
    process.env.UPLOADS_DRIVER = "s3";
    process.env.UPLOAD_SCAN_MODE = "strict";
    process.env.TRUST_PROXY = "1";
    process.env.TRANSCRIPTION_ENABLED = "false";
    process.env.DATABASE_URL = "sqlite::memory:";

    const { createSessionOptions } = await import("../localPasswordAuth");
    const options = createSessionOptions({
      secret: "desktop-super-secure-secret-value-12345",
      ttlMs: 60_000,
    });

    expect(options.proxy).toBe(false);
    expect(options.cookie?.sameSite).toBe("lax");
    expect(options.cookie?.secure).toBe(false);
    expect(options.cookie?.httpOnly).toBe(true);
  });
});
