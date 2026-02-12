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

describe("live coaching routes", () => {
  it("stores attempts and surfaces history/progress/latest upload", async () => {
    const uploadRes = await request
      .post("/api/uploads/audio")
      .attach("audio", Buffer.from("test"), "test.webm");
    expect(uploadRes.status).toBe(201);
    const uploadId = uploadRes.body.id;

    const attemptRes = await request.post("/api/live-coaching/attempt").send({
      uploadId,
      verseIndex: 0,
      verseCount: 1,
      scores: {
        overall: 80,
        pitch: 72,
        timing: 74,
        stability: 78,
        words: 85,
        label: "Overall",
      },
      tips: ["Test tip"],
      focusLine: "Line 1",
      focusAreas: ["Timing"],
      practiceMode: "full",
      debug: { offsetMs: 120 },
    });
    expect(attemptRes.status).toBe(201);

    const historyRes = await request.get(
      `/api/live-coaching/history?uploadId=${uploadId}&limit=5`
    );
    expect(historyRes.status).toBe(200);
    expect(Array.isArray(historyRes.body)).toBe(true);
    expect(historyRes.body[0].uploadId).toBe(uploadId);

    const latestUploadRes = await request.get("/api/live-coaching/latest-upload");
    expect(latestUploadRes.status).toBe(200);
    expect(latestUploadRes.body.id).toBe(uploadId);

    const progressRes = await request.get("/api/progress/summary");
    expect(progressRes.status).toBe(200);
    expect(progressRes.body.totalSessions).toBeGreaterThan(0);
    expect(progressRes.body.averageScore).toBeGreaterThan(0);
  });
});
