import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const serverEntry = path.join(process.cwd(), "dist", "index.js");
if (!fs.existsSync(serverEntry)) {
  console.error("Missing dist/index.js. Run `npm run build` first.");
  process.exit(1);
}

const port = Number(process.env.SMOKE_PORT || 5057);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const tmpDbPath = path.join(process.cwd(), "tmp-smoke.db");

const child = spawn(process.execPath, [serverEntry], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: host,
    PORT: String(port),
    RELEASE_MODE: "true",
    DATABASE_URL: `file:${tmpDbPath}`,
    USE_JSON_DB: "false",
    DISABLE_AUTH: "false",
    AUTH_PROVIDER: "local",
    SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
    UPLOADS_DRIVER: "local",
    ALLOW_LOCAL_UPLOADS_IN_PROD: "true",
    UPLOAD_SCAN_MODE: "basic",
    TRUST_PROXY: "true",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdoutLog = "";
let stderrLog = "";

child.stdout?.on("data", (chunk) => {
  const text = chunk.toString();
  stdoutLog += text;
  process.stdout.write(text);
});

child.stderr?.on("data", (chunk) => {
  const text = chunk.toString();
  stderrLog += text;
  process.stderr.write(text);
});

const stopServer = async () => {
  if (child.exitCode === null && !child.killed) {
    child.kill("SIGTERM");
    await wait(400);
  }
  if (fs.existsSync(tmpDbPath)) {
    fs.unlinkSync(tmpDbPath);
  }
};

const waitForHealth = async () => {
  const timeoutAt = Date.now() + 30000;
  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return response;
      }
    } catch {
      // Retry while booting.
    }
    await wait(300);
  }
  throw new Error("Timed out waiting for /api/health");
};

const run = async () => {
  try {
    const healthResponse = await waitForHealth();
    const health = await healthResponse.json();
    if (!health || typeof health !== "object") {
      throw new Error("Health endpoint returned invalid JSON");
    }

    const requiredFields = ["status", "readiness", "db", "storage", "jobs", "queue", "build"];
    for (const field of requiredFields) {
      if (!(field in health)) {
        throw new Error(`Health endpoint missing field: ${field}`);
      }
    }

    const openapiResponse = await fetch(`${baseUrl}/api/openapi.json`);
    if (!openapiResponse.ok) {
      throw new Error(`OpenAPI endpoint failed with status ${openapiResponse.status}`);
    }

    console.log("Release smoke checks passed.");
  } catch (error) {
    console.error("Release smoke checks failed.");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    if (stderrLog.trim()) {
      console.error("Server stderr:");
      console.error(stderrLog.trim());
    }
    if (stdoutLog.trim()) {
      console.error("Server stdout:");
      console.error(stdoutLog.trim());
    }
    process.exitCode = 1;
  } finally {
    await stopServer();
  }
};

void run();
