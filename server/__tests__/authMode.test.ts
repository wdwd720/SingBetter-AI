import { afterEach, describe, expect, it } from "vitest";
import { isAuthDisabled } from "../auth";

const originalDisableAuth = process.env.DISABLE_AUTH;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.DISABLE_AUTH = originalDisableAuth;
  process.env.NODE_ENV = originalNodeEnv;
});

describe("auth mode flags", () => {
  it("honors explicit DISABLE_AUTH=false in development", () => {
    process.env.NODE_ENV = "development";
    process.env.DISABLE_AUTH = "false";
    expect(isAuthDisabled()).toBe(false);
  });

  it("defaults to disabled in development when not configured", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DISABLE_AUTH;
    expect(isAuthDisabled()).toBe(true);
  });
});
