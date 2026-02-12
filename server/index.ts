import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { requestContext } from "./middleware/requestContext";
import { getRequestId } from "./lib/http";
import { contentTypeGuard, globalRateLimiter, secureHeaders } from "./middleware/security";
import { requestMetricsMiddleware } from "./observability";
import { startBackgroundJobs } from "./jobs";
import { startQueueWorker } from "./queue";
import { appConfig } from "./config";
import { corsPolicy } from "./middleware/cors";
import { redactSensitive } from "./lib/logger";
import { captureSentryException, initSentry, isSentryEnabled } from "./lib/sentry";

const app = express();
const httpServer = createServer(app);

app.set("etag", false);
app.set("trust proxy", appConfig.trustProxy);

app.use(requestContext);
app.use(secureHeaders);
app.use(corsPolicy);
app.use(globalRateLimiter);
app.use(requestMetricsMiddleware);
app.use(contentTypeGuard);

app.use((req, _res, next) => {
  if (req.url.startsWith("/api/v1/")) {
    req.url = req.url.replace("/api/v1/", "/api/");
  }
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "512kb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  res.on("finish", () => {
    if (!path.startsWith("/api")) return;
    const duration = Date.now() - start;
    const payload = {
      level: "info",
      requestId: getRequestId(req),
      method: req.method,
      path,
      status: res.statusCode,
      durationMs: duration,
    };
    log(JSON.stringify(redactSensitive(payload)));
  });
  next();
});

(async () => {
  await initSentry();
  await registerRoutes(httpServer, app);
  startBackgroundJobs();
  startQueueWorker();

  log(
    JSON.stringify({
      level: "info",
      event: "startup.runtime",
      sentryEnabled: isSentryEnabled(),
      env: appConfig.env,
      releaseMode: appConfig.releaseMode,
      version: appConfig.version,
      commitSha: appConfig.commitSha,
    }),
  );

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const code = err.code || "INTERNAL_ERROR";
    const requestId = typeof err.requestId === "string" ? err.requestId : getRequestId(_req as Request);
    const details = err.details;

    const errorPayload = redactSensitive({
        level: "error",
        requestId,
        code,
        message,
        status,
        details,
        stack: err?.stack,
      });
    console.error(JSON.stringify(errorPayload));
    captureSentryException(err, { requestId, code, status });

    if (res.headersSent) {
      return next(err);
    }

    const includeStack = process.env.NODE_ENV === "development";
    return res.status(status).json({
      code,
      message,
      requestId,
      ...(details ? { details } : {}),
      ...(includeStack ? { stack: err.stack } : {}),
    });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const defaultHost =
    process.env.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0";
  const host = process.env.HOST || defaultHost;

  const listenOptions =
    process.platform === "win32"
      ? { port, host }
      : { port, host, reusePort: true };

  httpServer.listen(listenOptions, () => {
    log(`Serving on http://${host}:${port}`);
  });

})();
