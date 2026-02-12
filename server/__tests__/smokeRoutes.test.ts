import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import supertest from "supertest";
import { createServer } from "http";
import { requestContext } from "../middleware/requestContext";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  process.env.DISABLE_AUTH = "true";
  process.env.DATABASE_URL = "sqlite::memory:";
  process.env.USE_JSON_DB = "false";

  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const server = createServer(app);
  await registerRoutes(server, app);
  request = supertest(app);
}, 20000);

describe("server smoke routes", () => {
  it("returns local dev auth user", async () => {
    const response = await request.get("/api/auth/user");
    expect(response.status).toBe(200);
    expect(response.body.id).toBe("local-user");
  });

  it("creates and lists sessions in sqlite mode", async () => {
    const create = await request.post("/api/sessions").send({
      mode: "live_coach",
      goal: "pitch",
    });
    expect(create.status).toBe(201);
    expect(create.body.id).toBeGreaterThan(0);

    const list = await request.get("/api/sessions");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
  });

  it("supports health and versioned API alias", async () => {
    const health = await request.get("/api/health");
    expect(health.status).toBe(200);
    expect(["ok", "degraded"]).toContain(health.body.status);
    expect(health.body).toMatchObject({
      db: expect.any(Object),
      storage: expect.any(Object),
      jobs: expect.any(Object),
      queue: expect.any(Object),
    });

    const aliased = await request.get("/api/v1/auth/user");
    expect(aliased.status).toBe(200);
    expect(aliased.body.id).toBe("local-user");
  });
});
