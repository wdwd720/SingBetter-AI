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

  const { registerRoutes } = await import("../routes");
  const app = express();
  app.use(requestContext);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const server = createServer(app);
  await registerRoutes(server, app);
  request = supertest(app);
}, 20000);

describe("error response shape", () => {
  it("includes requestId on API error payload", async () => {
    const response = await request.post("/api/uploads/audio");
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("UPLOAD_MISSING");
    expect(typeof response.body.requestId).toBe("string");
    expect(response.body.requestId.length).toBeGreaterThan(0);
  });
});
