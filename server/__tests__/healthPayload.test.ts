import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { createServer } from "http";
import { requestContext } from "../middleware/requestContext";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DISABLE_AUTH = "true";
  process.env.DATABASE_URL = "sqlite::memory:";
  process.env.USE_JSON_DB = "false";
  process.env.TRANSCRIPTION_ENABLED = "false";

  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const server = createServer(app);
  await registerRoutes(server, app);
  request = supertest(app);
}, 20000);

describe("health payload", () => {
  it("returns readiness details and launch metadata", async () => {
    const response = await request.get("/api/health");
    expect(response.status).toBe(200);
    expect(["ok", "degraded"]).toContain(response.body.status);
    expect(response.body.mode).toBeTruthy();
    expect(typeof response.body.mode.devMode).toBe("boolean");
    expect(response.body.db).toBeTruthy();
    expect(response.body.storage).toBeTruthy();
    expect(response.body.jobs).toBeTruthy();
    expect(response.body.build).toBeTruthy();
    expect(typeof response.body.build.version).toBe("string");
  });
});
