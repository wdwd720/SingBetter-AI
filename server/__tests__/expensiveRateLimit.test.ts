import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { createServer } from "http";
import { requestContext } from "../middleware/requestContext";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  process.env.DISABLE_AUTH = "true";
  process.env.DATABASE_URL = "sqlite::memory:";
  process.env.USE_JSON_DB = "false";
  process.env.RATE_LIMIT_EXPENSIVE_MAX = "2";
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

describe("expensive endpoint rate limiting", () => {
  it("limits repeated calls to transcription endpoints", async () => {
    const first = await request.get("/api/transcribe-test");
    expect(first.status).not.toBe(429);

    const second = await request.get("/api/transcribe-test");
    expect(second.status).not.toBe(429);

    const third = await request.get("/api/transcribe-test");
    expect(third.status).toBe(429);
    expect(third.body.code).toBe("RATE_LIMITED");
  });
});
