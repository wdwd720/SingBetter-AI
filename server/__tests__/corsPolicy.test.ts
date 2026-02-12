import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { createServer } from "http";
import { requestContext } from "../middleware/requestContext";
import { corsPolicy } from "../middleware/cors";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  process.env.NODE_ENV = "production";
  process.env.RELEASE_MODE = "true";
  process.env.DISABLE_AUTH = "false";
  process.env.AUTH_PROVIDER = "local";
  process.env.SESSION_SECRET = "cors-policy-session-secret-123456789";
  process.env.DATABASE_URL = "sqlite::memory:";
  process.env.USE_JSON_DB = "false";
  process.env.UPLOADS_DRIVER = "local";
  process.env.ALLOW_LOCAL_UPLOADS_IN_PROD = "true";
  process.env.UPLOAD_SCAN_MODE = "strict";
  process.env.TRANSCRIPTION_ENABLED = "false";
  process.env.TRUST_PROXY = "1";
  delete process.env.CORS_ALLOWED_ORIGINS;

  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(requestContext);
  app.use(corsPolicy);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const server = createServer(app);
  await registerRoutes(server, app);
  request = supertest(app);
}, 20000);

describe("cors policy", () => {
  it("denies unknown origins in production mode", async () => {
    const response = await request
      .get("/api/health")
      .set("Origin", "https://evil.example");
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("CORS_ORIGIN_BLOCKED");
  });

  it("allows same-origin requests", async () => {
    const response = await request
      .get("/api/health")
      .set("Origin", "http://127.0.0.1");
    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1",
    );
  });
});
