import crypto from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { createServer } from "http";
import { requestContext } from "../middleware/requestContext";

let agent: supertest.SuperAgentTest;

const getCsrfToken = async () => {
  const response = await agent.get("/api/csrf-token");
  expect(response.status).toBe(200);
  expect(typeof response.body.csrfToken).toBe("string");
  return response.body.csrfToken as string;
};

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const fromBase32 = (value: string): Buffer => {
  const cleaned = value.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) continue;
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

const generateTotp = (secret: string): string => {
  const window = Math.floor(Date.now() / 1000 / 30);
  return hotp(secret, window);
};

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  process.env.DISABLE_AUTH = "false";
  process.env.AUTH_PROVIDER = "local";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.DATABASE_URL = "sqlite::memory:";
  process.env.USE_JSON_DB = "false";

  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const server = createServer(app);
  await registerRoutes(server, app);
  agent = supertest.agent(app);
}, 20000);

describe("local auth routes", () => {
  it("supports signup, authenticated access, logout, and login", async () => {
    const email = `mihir${Date.now()}${Math.floor(Math.random() * 10000)}@example.com`;

    const unauthBefore = await agent.get("/api/auth/user");
    expect(unauthBefore.status).toBe(401);

    const signupRes = await agent.post("/api/auth/signup").send({
      email,
      password: "Passw0rd!123",
      firstName: "Mihir",
      lastName: "Modi",
    });
    expect(signupRes.status).toBe(201);
    expect(signupRes.body.email).toBe(email);

    const userAfterSignup = await agent.get("/api/auth/user");
    expect(userAfterSignup.status).toBe(200);
    expect(userAfterSignup.body.email).toBe(email);

    const csrfToken = await getCsrfToken();
    const protectedRes = await agent.post("/api/sessions").send({
      mode: "live_coach",
      goal: "pitch",
    }).set("X-CSRF-Token", csrfToken);
    expect(protectedRes.status).toBe(201);

    const logoutRes = await agent.post("/api/auth/logout");
    expect(logoutRes.status).toBe(204);

    const unauthAfterLogout = await agent.get("/api/auth/user");
    expect(unauthAfterLogout.status).toBe(401);

    const loginRes = await agent.post("/api/auth/login").send({
      email,
      password: "Passw0rd!123",
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.email).toBe(email);

    const userAfterLogin = await agent.get("/api/auth/user");
    expect(userAfterLogin.status).toBe(200);
    expect(userAfterLogin.body.email).toBe(email);
  });

  it("supports reset, profile update, and optional MFA", async () => {
    const email = `user${Date.now()}${Math.floor(Math.random() * 10000)}@example.com`;
    const initialPassword = "Passw0rd!123";
    const newPassword = "N3wPassw0rd!456";

    const signupRes = await agent.post("/api/auth/signup").send({
      email,
      password: initialPassword,
      firstName: "First",
      lastName: "Last",
    });
    expect(signupRes.status).toBe(201);

    const profileBefore = await agent.get("/api/profile");
    expect(profileBefore.status).toBe(200);
    expect(profileBefore.body.user.email).toBe(email);

    const csrfToken = await getCsrfToken();
    const profileUpdate = await agent.put("/api/profile").send({
      firstName: "Updated",
      locale: "es",
      emailNotifications: false,
      inAppNotifications: true,
    }).set("X-CSRF-Token", csrfToken);
    expect(profileUpdate.status).toBe(200);
    expect(profileUpdate.body.user.firstName).toBe("Updated");
    expect(profileUpdate.body.settings.locale).toBe("es");

    const resetRequest = await agent.post("/api/auth/password/request-reset").send({
      email,
    });
    expect(resetRequest.status).toBe(200);
    expect(typeof resetRequest.body.resetToken).toBe("string");

    const resetComplete = await agent.post("/api/auth/password/reset").send({
      token: resetRequest.body.resetToken,
      newPassword,
    });
    expect(resetComplete.status).toBe(204);

    await agent.post("/api/auth/logout");

    const oldLogin = await agent.post("/api/auth/login").send({
      email,
      password: initialPassword,
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await agent.post("/api/auth/login").send({
      email,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);

    const mfaSetup = await agent.post("/api/auth/mfa/setup");
    expect(mfaSetup.status).toBe(200);
    expect(typeof mfaSetup.body.secret).toBe("string");

    const otp = generateTotp(mfaSetup.body.secret);
    const mfaVerify = await agent.post("/api/auth/mfa/verify").send({
      token: otp,
    });
    expect(mfaVerify.status).toBe(200);
    expect(mfaVerify.body.enabled).toBe(true);

    await agent.post("/api/auth/logout");

    const loginNeedsMfa = await agent.post("/api/auth/login").send({
      email,
      password: newPassword,
    });
    expect(loginNeedsMfa.status).toBe(202);
    expect(loginNeedsMfa.body.mfaRequired).toBe(true);

    const mfaLogin = await agent.post("/api/auth/mfa/login/verify").send({
      token: generateTotp(mfaSetup.body.secret),
    });
    expect(mfaLogin.status).toBe(200);
    expect(mfaLogin.body.email).toBe(email);
  });
});
