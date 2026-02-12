import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { createServer } from "http";
import { requestContext } from "../middleware/requestContext";

let agent: supertest.SuperAgentTest;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DISABLE_AUTH = "false";
  process.env.AUTH_PROVIDER = "local";
  process.env.CSRF_ENABLED = "true";
  process.env.SESSION_SECRET = "csrf-test-session-secret-1234567890";
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

describe("csrf protection", () => {
  it("requires csrf token on protected state-changing routes", async () => {
    const email = `csrf${Date.now()}${Math.floor(Math.random() * 10000)}@example.com`;
    const signup = await agent.post("/api/auth/signup").send({
      email,
      password: "Passw0rd!123",
      firstName: "Csrf",
      lastName: "User",
    });
    expect(signup.status).toBe(201);

    const blocked = await agent.post("/api/sessions").send({
      mode: "live_coach",
      goal: "pitch",
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("CSRF_FORBIDDEN");

    const csrf = await agent.get("/api/csrf-token");
    expect(csrf.status).toBe(200);
    expect(typeof csrf.body.csrfToken).toBe("string");

    const allowed = await agent
      .post("/api/sessions")
      .set("X-CSRF-Token", csrf.body.csrfToken)
      .send({
        mode: "live_coach",
        goal: "pitch",
      });
    expect(allowed.status).toBe(201);
  });
});
