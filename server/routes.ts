import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { api } from "@shared/routes";
import { z } from "zod";
import { AssemblyAI } from "assemblyai";
import { flattenWords } from "./lib/karaoke";
import { buildDetailedFeedback, type ReferenceLine } from "./lib/feedback";
import type { WordToken } from "./lib/alignment";
import { analyzePerformance, computeOverallScore, resolveWeights } from "./lib/performance";
import express from "express";
import {
  resolveAuthMode,
  localAuthMiddleware,
  registerLocalAuthRoutes,
} from "./auth";
import {
  getLocalPasswordUserId,
  localPasswordIsAuthenticated,
  registerLocalPasswordAuthRoutes,
  setupLocalPasswordAuth,
} from "./localPasswordAuth";
import {
  getLatestUpload,
  getLatestUploadForUser,
  getUpload,
  getRecording,
  listRecentAttempts,
  saveAttempt,
  saveRecording,
  saveUpload,
} from "./liveCoachingRepo";
import { ApiError, sendError } from "./lib/http";
import { withRetry, withTimeout, isTransientError } from "./lib/retry";
import { mountUploadStatic, persistUploadedFile, resolveAudioSource, upload } from "./uploadStorage";
import { registerPlatformRoutes } from "./platformRoutes";
import { appConfig } from "./config";
import { createCsrfProtection, csrfTokenHandler } from "./middleware/csrf";
import { createRateLimiter } from "./middleware/security";

const assemblyClient = appConfig.transcription.enabled && process.env.ASSEMBLYAI_API_KEY
  ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
  : null;

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const uploadRateLimiter = createRateLimiter(
    appConfig.rateLimit.expensiveMaxRequests,
  );
  const transcribeRateLimiter = createRateLimiter(
    appConfig.rateLimit.expensiveMaxRequests,
  );
  const analysisRateLimiter = createRateLimiter(
    appConfig.rateLimit.expensiveMaxRequests,
  );
  type TranscriptionWord = {
    start: number;
    end: number;
    word: string;
  };

  type TranscriptionSegment = {
    start: number;
    end: number;
    text: string;
    words: TranscriptionWord[] | undefined;
  };

  const parseNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };

  const toSeconds = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0;
    return Math.max(0, value / 1000);
  };

  const normalizeWord = (word: any): TranscriptionWord | null => {
    const text =
      typeof word?.text === "string"
        ? word.text
        : typeof word?.word === "string"
          ? word.word
          : typeof word?.punctuated_word === "string"
            ? word.punctuated_word
            : "";
    if (!text) return null;
    const startMs =
      typeof word?.start === "number"
        ? word.start
        : typeof word?.start_time === "number"
          ? word.start_time
          : 0;
    const endMs =
      typeof word?.end === "number"
        ? word.end
        : typeof word?.end_time === "number"
          ? word.end_time
          : startMs;
    return {
      word: text,
      start: toSeconds(startMs),
      end: toSeconds(endMs),
    };
  };

  const normalizeWords = (words: any[]): TranscriptionWord[] =>
    words
      .map((word) => normalizeWord(word))
      .filter((word): word is TranscriptionWord => Boolean(word?.word));

  const buildSegmentsFromSentenceLike = (
    items: any[],
    fallbackWords: TranscriptionWord[]
  ): TranscriptionSegment[] => {
    const segments = items
      .map((item) => {
        const rawStart =
          typeof item?.start === "number"
            ? item.start
            : typeof item?.start_time === "number"
              ? item.start_time
              : undefined;
        const rawEnd =
          typeof item?.end === "number"
            ? item.end
            : typeof item?.end_time === "number"
              ? item.end_time
              : undefined;
        const start = typeof rawStart === "number" ? toSeconds(rawStart) : 0;
        const end = typeof rawEnd === "number" ? toSeconds(rawEnd) : start;

        let words = Array.isArray(item?.words)
          ? normalizeWords(item.words)
          : undefined;
        if (!words || words.length === 0) {
          if (end > start) {
            words = fallbackWords.filter(
              (word) => word.end > start && word.start < end
            );
          }
        }

        const text =
          typeof item?.text === "string"
            ? item.text
            : words && words.length > 0
              ? words.map((word) => word.word).join(" ")
              : "";
        const segmentStart = words?.[0]?.start ?? start;
        const segmentEnd =
          words?.[words.length - 1]?.end ??
          (end > segmentStart ? end : segmentStart);

        if (!Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd)) {
          return null;
        }

        return {
          start: segmentStart,
          end: Math.max(segmentStart, segmentEnd),
          text,
          words: words && words.length > 0 ? words : undefined,
        };
      })
      .filter((segment): segment is TranscriptionSegment => Boolean(segment));

    return segments.sort((a, b) => a.start - b.start);
  };

  const buildSegmentsFromWords = (
    words: TranscriptionWord[]
  ): TranscriptionSegment[] => {
    if (words.length === 0) return [];
    const segments: TranscriptionSegment[] = [];
    const maxSegmentSec = 12;
    const minSegmentSec = 6;
    let bucket: TranscriptionWord[] = [];

    const flush = () => {
      if (bucket.length === 0) return;
      const start = bucket[0].start;
      const end = bucket[bucket.length - 1].end;
      const text = bucket.map((word) => word.word).join(" ");
      segments.push({
        start,
        end,
        text,
        words: bucket,
      });
      bucket = [];
    };

    words.forEach((word) => {
      if (bucket.length === 0) {
        bucket.push(word);
        return;
      }
      bucket.push(word);
      const duration = word.end - bucket[0].start;
      const endsSentence = /[.!?]$/.test(word.word);
      if (duration >= maxSegmentSec || (endsSentence && duration >= minSegmentSec)) {
        flush();
      }
    });

    flush();
    return segments;
  };

  const fetchSentenceSegments = async (
    transcriptId: string,
    fallbackWords: TranscriptionWord[]
  ): Promise<TranscriptionSegment[]> => {
    if (!assemblyClient) return [];
    const transcriptApi = assemblyClient.transcripts as any;
    const fetchSegments = async (method: "sentences" | "paragraphs") => {
      if (typeof transcriptApi?.[method] !== "function") return [];
      const result = await transcriptApi[method](transcriptId);
      const items = Array.isArray(result?.[method])
        ? result[method]
        : Array.isArray(result?.sentences)
          ? result.sentences
          : Array.isArray(result?.paragraphs)
            ? result.paragraphs
            : Array.isArray(result)
              ? result
              : [];
      return buildSegmentsFromSentenceLike(items, fallbackWords);
    };

    try {
      const sentences = await fetchSegments("sentences");
      if (sentences.length > 0) return sentences;
    } catch (err) {
      console.warn("AssemblyAI sentences fetch failed", err);
    }

    try {
      const paragraphs = await fetchSegments("paragraphs");
      if (paragraphs.length > 0) return paragraphs;
    } catch (err) {
      console.warn("AssemblyAI paragraphs fetch failed", err);
    }

    return [];
  };

  const applyRangeFilter = (
    segments: TranscriptionSegment[],
    rangeStart: number,
    rangeEnd: number
  ): { segments: TranscriptionSegment[]; text: string } => {
    const filtered = segments
      .map((segment) => {
        const segmentStart = segment.start;
        const segmentEnd = segment.end;
        if (segmentEnd <= rangeStart || segmentStart >= rangeEnd) return null;

        const adjustedWords = segment.words
          ? segment.words
              .filter((word) => word.end > rangeStart && word.start < rangeEnd)
              .map((word) => {
                const start = Math.max(word.start, rangeStart) - rangeStart;
                const end = Math.min(word.end, rangeEnd) - rangeStart;
                return {
                  ...word,
                  start: Math.max(0, start),
                  end: Math.max(start, end),
                };
              })
              .filter((word) => word.end > word.start)
          : undefined;

        const fallbackStart =
          Math.max(segmentStart, rangeStart) - rangeStart;
        const fallbackEnd =
          Math.min(segmentEnd, rangeEnd) - rangeStart;

        const start = adjustedWords?.[0]?.start ?? Math.max(0, fallbackStart);
        const end = adjustedWords?.[adjustedWords.length - 1]?.end ??
          Math.max(start, fallbackEnd);

        if (end <= start) return null;

        const text =
          adjustedWords && adjustedWords.length > 0
            ? adjustedWords.map((word) => word.word).join(" ")
            : segment.text;

        return {
          start,
          end,
          text,
          words: adjustedWords && adjustedWords.length > 0 ? adjustedWords : undefined,
        };
      })
      .filter((segment): segment is TranscriptionSegment => Boolean(segment));

    const text = filtered
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    return { segments: filtered, text };
  };

  const transcribeWithAssemblyAI = async (
    filePath: string,
    options: { languageCode?: string }
  ): Promise<{ text: string; segments: TranscriptionSegment[]; words: TranscriptionWord[] }> => {
    if (!appConfig.transcription.enabled) {
      throw new ApiError(
        503,
        "TRANSCRIPTION_DISABLED",
        "Transcription is disabled by server configuration",
      );
    }
    if (!assemblyClient) {
      throw new ApiError(400, "ASSEMBLYAI_KEY_MISSING", "ASSEMBLYAI_API_KEY is not set");
    }

    const payload = {
      audio: filePath,
      speech_models: ["universal-3-pro", "universal-2"],
      punctuate: true,
      format_text: true,
      ...(options.languageCode ? { language_code: options.languageCode } : {}),
    } as any;

    const transcriptsApi = assemblyClient.transcripts as any;
    const submitted = await transcriptsApi.submit(payload);
    const completed = await transcriptsApi.waitUntilReady(submitted.id, {
      pollingInterval: 3000,
      pollingTimeout: 10 * 60 * 1000,
    });

    if ((completed as any)?.status === "error") {
      const rawMessage =
        typeof (completed as any)?.error === "string"
          ? (completed as any).error
          : "Transcription failed";
      const isQuota =
        /quota|credits|billing|payment|insufficient/i.test(rawMessage);
      if (isQuota) {
        throw new ApiError(429, "ASSEMBLYAI_QUOTA_EXCEEDED", rawMessage, {
          provider: "assemblyai",
        });
      }
      throw new ApiError(502, "ASSEMBLYAI_FAILED", rawMessage, {
        provider: "assemblyai",
      });
    }

    const rawWords = Array.isArray((completed as any)?.words)
      ? (completed as any).words
      : [];
    const words = normalizeWords(rawWords);

    let segments: TranscriptionSegment[] = [];
    const utterances = Array.isArray((completed as any)?.utterances)
      ? (completed as any).utterances
      : [];
    if (utterances.length > 0) {
      segments = buildSegmentsFromSentenceLike(utterances, words);
    }
    if (segments.length === 0) {
      segments = await fetchSentenceSegments((completed as any).id, words);
    }
    if (segments.length === 0) {
      segments = buildSegmentsFromWords(words);
    }

    let text =
      typeof (completed as any)?.text === "string"
        ? (completed as any).text
        : "";
    if (!text && segments.length > 0) {
      text = segments.map((segment) => segment.text).join(" ").trim();
    }
    if (!text && segments.length === 0 && words.length > 0) {
      text = words.map((word) => word.word).join(" ");
    }
    if (!text && segments.length === 0) {
      segments = [
        {
          start: 0,
          end: 0,
          text: "",
          words: undefined,
        },
      ];
    }

    return { text, segments, words };
  };

  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/v1/")) {
      req.url = req.url.replace("/api/v1/", "/api/");
    }
    next();
  });

  // 1. Setup Auth
  const authMode = resolveAuthMode();
  let requireAuth: express.RequestHandler;
  let getRequestUserId: (req: express.Request) => string;

  if (authMode === "disabled") {
    registerLocalAuthRoutes(app);
    requireAuth = localAuthMiddleware;
    getRequestUserId = () => "local-user";
  } else if (authMode === "replit") {
    await setupAuth(app);
    registerAuthRoutes(app);
    requireAuth = isAuthenticated;
    getRequestUserId = (req: express.Request) => (req.user as any).claims.sub;
  } else {
    await setupLocalPasswordAuth(app);
    registerLocalPasswordAuthRoutes(app);
    requireAuth = localPasswordIsAuthenticated;
    getRequestUserId = getLocalPasswordUserId;
  }

  const csrfProtection = createCsrfProtection({
    enabled: appConfig.csrf.enabled && authMode !== "disabled",
    exemptPaths: [
      "/api/auth/login",
      "/api/auth/signup",
      "/api/auth/password/request-reset",
      "/api/auth/password/reset",
      "/api/auth/mfa/login/verify",
    ],
  });
  if (authMode !== "disabled") {
    app.get("/api/csrf-token", requireAuth, csrfTokenHandler);
  } else {
    app.get("/api/csrf-token", (_req, res) => {
      res.json({ csrfToken: null, enabled: false });
    });
  }
  app.use(csrfProtection);

  // Serve local-disk uploads when the local upload driver is active.
  mountUploadStatic(app);
  registerPlatformRoutes(app, requireAuth, getRequestUserId);

  // 2. Session Routes
  app.post(api.sessions.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.sessions.create.input.parse(req.body);
      const session = await storage.createSession({
        ...input,
        userId: getRequestUserId(req), // From Replit Auth or local dev
      });
      res.status(201).json(session);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  app.get(api.sessions.list.path, requireAuth, async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const limitParam = parseNumber((req.query as any)?.limit);
      const offsetParam = parseNumber((req.query as any)?.offset);
      const modeFilter =
        typeof (req.query as any)?.mode === "string"
          ? (req.query as any).mode.trim().toLowerCase()
          : undefined;
      const difficultyFilter =
        typeof (req.query as any)?.difficulty === "string"
          ? (req.query as any).difficulty.trim().toLowerCase()
          : undefined;
      const sortDirection =
        typeof (req.query as any)?.sort === "string" &&
        (req.query as any).sort.toLowerCase() === "asc"
          ? "asc"
          : "desc";
      const limit = Math.min(100, Math.max(1, limitParam ?? 20));
      const offset = Math.max(0, offsetParam ?? 0);

      const fetched = await storage.getUserSessions(userId, Math.max(100, limit + offset), 0);
      const filtered = fetched.filter((session) => {
        if (modeFilter && session.mode.toLowerCase() !== modeFilter) return false;
        if (difficultyFilter && (session.difficulty || "").toLowerCase() !== difficultyFilter) return false;
        return true;
      });
      const sorted = [...filtered].sort((a, b) => {
        const left = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const right = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return sortDirection === "asc" ? left - right : right - left;
      });
      res.json(sorted.slice(offset, offset + limit));
    } catch (err) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get(api.sessions.get.path, requireAuth, async (req, res) => {
    try {
      const session = await storage.getSession(Number(req.params.id));
      if (!session) return res.status(404).json({ message: "Session not found" });
      
      // Security check
      if (authMode !== "disabled" && session.userId !== getRequestUserId(req)) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      res.json(session);
    } catch (err) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post(api.sessions.finish.path, requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.sessions.finish.input.parse(req.body);
      
      const session = await storage.getSession(id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (authMode !== "disabled" && session.userId !== getRequestUserId(req)) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Update session duration & end time
      await storage.updateSession(id, {
        endedAt: new Date(),
        durationSec: input.durationSec,
      });

      // Add metrics
      await storage.addSessionMetrics({
        ...input.metrics,
        sessionId: id,
      });

      // Add events
      if (input.events) {
        await storage.addSessionEvents(input.events.map(e => ({ ...e, sessionId: id })));
      }

      const updatedSession = await storage.getSession(id);
      res.json(updatedSession);

    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        console.error(err);
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // 3. Progress Routes
  app.get(api.progress.get.path, requireAuth, async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const progress = await storage.getUserProgress(userId);
      res.json(progress);
    } catch (err) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // 4. Upload Route (Special handling for multipart)
  app.post(
    '/api/sessions/:id/upload',
    uploadRateLimiter,
    requireAuth,
    upload.single('audio'),
    async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    
    try {
      const sessionId = Number(req.params.id);
      const session = await storage.getSession(sessionId);
      if (!session) {
        return sendError(res, req, 404, "SESSION_NOT_FOUND", "Session not found");
      }
      const requestUserId = getRequestUserId(req);
      if (authMode !== "disabled" && session.userId !== requestUserId) {
        return sendError(res, req, 403, "FORBIDDEN", "You do not have access to this session");
      }

      const stored = await persistUploadedFile(req.file);
      const artifact = await storage.addAudioArtifact({
        sessionId,
        type: 'user_recording',
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        mimeType: req.file.mimetype,
      });
      
      res.json(artifact);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Upload failed" });
    }
    },
  );

  app.post(
    "/api/uploads/audio",
    uploadRateLimiter,
    requireAuth,
    upload.single("audio"),
    async (req, res) => {
    if (!req.file) {
      return sendError(res, req, 400, "UPLOAD_MISSING", "No file uploaded");
    }

    try {
      const stored = await persistUploadedFile(req.file);
      const saved = await saveUpload({
        userId: getRequestUserId(req),
        filename: req.file.originalname,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
      });

      res.status(201).json(saved);
    } catch (err) {
      console.error("Upload save failed:", err);
      return sendError(res, req, 500, "UPLOAD_FAILED", "Failed to save upload");
    }
    },
  );

  app.get("/api/live-coaching/latest-upload", requireAuth, async (req, res) => {
    try {
      const latest = await getLatestUploadForUser(getRequestUserId(req));
      if (!latest) {
        return res.status(404).json({ message: "No uploaded audio found" });
      }
      res.json(latest);
    } catch (err) {
      console.error("Latest upload fetch failed:", err);
      return sendError(res, req, 500, "LATEST_UPLOAD_FAILED", "Failed to load latest upload");
    }
  });

  app.post(
    "/api/recordings/upload",
    uploadRateLimiter,
    requireAuth,
    upload.single("audio"),
    async (req, res) => {
    if (!req.file) {
      return sendError(res, req, 400, "RECORDING_MISSING", "No recording uploaded");
    }

    const durationSec = Number(req.body?.durationSec || 0);
    try {
      const stored = await persistUploadedFile(req.file);
      const saved = await saveRecording({
        userId: getRequestUserId(req),
        filename: req.file.originalname,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
      });

      res.status(201).json({ ...saved, recordingUrl: saved.publicUrl });
    } catch (err) {
      console.error("Recording save failed:", err);
      return sendError(res, req, 500, "RECORDING_UPLOAD_FAILED", "Failed to save recording");
    }
    },
  );

  app.post(
    "/api/transcribe",
    transcribeRateLimiter,
    requireAuth,
    upload.single("audio"),
    async (req, res) => {
    try {
      let filePath: string | undefined;
      let fileName: string | undefined;

      if (req.file) {
        const stored = await persistUploadedFile(req.file);
        filePath = stored.transcriptionSource;
        fileName = req.file.originalname;
      } else if (req.body?.uploadId) {
        const uploadId = Number(req.body.uploadId);
        const upload = await getUpload(uploadId);
        if (!upload) {
          return res.status(404).json({ message: "Upload not found" });
        }
        if (authMode !== "disabled" && upload.userId !== getRequestUserId(req)) {
          return sendError(res, req, 403, "FORBIDDEN", "You do not have access to this upload");
        }
        filePath = resolveAudioSource(upload);
        fileName = upload.filename;
      }

      if (!filePath || !fileName) {
        return res.status(400).json({ message: "No audio provided" });
      }

      const mode = typeof req.body?.mode === "string" ? req.body.mode : undefined;
      const startSec = parseNumber(req.body?.startSec);
      const endSec = parseNumber(req.body?.endSec);
      const languageCode = typeof req.body?.language === "string" ? req.body.language : undefined;

      let rangeStart = startSec;
      let rangeEnd = endSec;
      const warnings: string[] = [];

      if (mode === "quick") {
        rangeStart = 0;
        rangeEnd = 60;
        warnings.push("quick mode: returned first 60s");
      }

      const transcribeResult = await withRetry(
        () =>
          withTimeout(
            transcribeWithAssemblyAI(filePath, { languageCode }),
            11 * 60 * 1000,
            "Transcription timed out"
          ),
        { retries: 1, isRetryable: isTransientError }
      );
      const { text, segments } = transcribeResult;
      let outputSegments = segments;
      let outputText = text;

      if (
        typeof rangeStart === "number" &&
        typeof rangeEnd === "number" &&
        Number.isFinite(rangeStart) &&
        Number.isFinite(rangeEnd) &&
        rangeEnd > rangeStart
      ) {
        const filtered = applyRangeFilter(segments, rangeStart, rangeEnd);
        outputSegments = filtered.segments;
        outputText = filtered.text || outputText;
        warnings.push("range requested; transcribed full audio then filtered");
      }

      const words = flattenWords(outputSegments);

      res.json({
        text: outputText,
        segments: outputSegments,
        words,
        ...(warnings.length ? { warnings } : {}),
      });
    } catch (err) {
      const code =
        typeof (err as any)?.code === "string" ? (err as any).code : undefined;
      if (code === "TRANSCRIPTION_DISABLED") {
        return sendError(
          res,
          req,
          503,
          "TRANSCRIPTION_DISABLED",
          "Transcription is disabled by server configuration",
        );
      }
      if (code === "ASSEMBLYAI_KEY_MISSING") {
        return sendError(res, req, 400, "ASSEMBLYAI_KEY_MISSING", "ASSEMBLYAI_API_KEY is not set");
      }
      if (code === "ASSEMBLYAI_QUOTA_EXCEEDED") {
        return sendError(
          res,
          req,
          429,
          "ASSEMBLYAI_QUOTA_EXCEEDED",
          "Transcription quota exceeded. Try manual lyrics or upgrade your plan."
        );
      }
      console.error("Transcription failed:", err);
      return sendError(res, req, 500, "TRANSCRIBE_FAILED", "Transcription failed", {
        provider: "assemblyai",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    },
  );

  app.get("/api/transcribe-test", transcribeRateLimiter, requireAuth, async (req, res) => {
    try {
      const latest =
        (await getLatestUploadForUser(getRequestUserId(req))) ??
        (await getLatestUpload());
      if (!latest) {
        return res.status(404).json({ message: "No uploaded audio found" });
      }

      const languageCode =
        typeof req.query?.language === "string" ? req.query.language : undefined;
      const source = resolveAudioSource(latest);
      if (!source) {
        return sendError(res, req, 500, "UPLOAD_SOURCE_UNAVAILABLE", "Upload source is unavailable");
      }
      const { text, segments } = await withRetry(
        () =>
          withTimeout(
            transcribeWithAssemblyAI(source, {
              languageCode,
            }),
            11 * 60 * 1000,
            "Transcription timed out"
          ),
        { retries: 1, isRetryable: isTransientError }
      );
      const words = flattenWords(segments);

      res.json({ text, segments, words });
    } catch (err) {
      const code =
        typeof (err as any)?.code === "string" ? (err as any).code : undefined;
      if (code === "TRANSCRIPTION_DISABLED") {
        return sendError(
          res,
          req,
          503,
          "TRANSCRIPTION_DISABLED",
          "Transcription is disabled by server configuration",
        );
      }
      if (code === "ASSEMBLYAI_KEY_MISSING") {
        return sendError(res, req, 400, "ASSEMBLYAI_KEY_MISSING", "ASSEMBLYAI_API_KEY is not set");
      }
      if (code === "ASSEMBLYAI_QUOTA_EXCEEDED") {
        return sendError(
          res,
          req,
          429,
          "ASSEMBLYAI_QUOTA_EXCEEDED",
          "Transcription quota exceeded. Try manual lyrics."
        );
      }
      console.error(err);
      return sendError(res, req, 500, "TRANSCRIBE_FAILED", "Transcription test failed", {
        provider: "assemblyai",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/api/analyze-performance", analysisRateLimiter, requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        referenceAudioUrl: z.string().optional(),
        recordingUrl: z.string().optional(),
        recordingId: z.number().optional(),
        verseStartSec: z.number().optional(),
        verseEndSec: z.number().optional(),
        lyricsText: z.string().optional(),
        referenceDurationSec: z.number().optional(),
        recordingDurationSec: z.number().optional(),
        estimatedOffsetMs: z.number().optional(),
        practiceMode: z.enum(["full", "words", "timing", "pitch"]).optional(),
        forceAnalyze: z.boolean().optional(),
        calibrationMetrics: z
          .object({
            rmsAvg: z.number(),
            peak: z.number(),
            noiseFloor: z.number(),
            snrDb: z.number(),
            clippingPct: z.number(),
            sampleSec: z.number(),
          })
          .optional(),
        referenceContour: z
          .array(z.object({ time: z.number(), frequency: z.number() }))
          .optional(),
        recordingContour: z
          .array(z.object({ time: z.number(), frequency: z.number() }))
          .optional(),
        referenceEnvelope: z.array(z.number()).optional(),
        recordingEnvelope: z.array(z.number()).optional(),
        referenceWords: z
          .array(
            z.object({
              word: z.string(),
              start: z.number(),
              end: z.number(),
              lineIndex: z.number().optional(),
              wordIndex: z.number().optional(),
            })
          )
          .optional(),
        referenceLines: z
          .array(
            z.object({
              index: z.number(),
              text: z.string(),
              start: z.number(),
              end: z.number(),
            })
          )
          .optional(),
        debugTiming: z.boolean().optional(),
      });

      const input = schema.parse(req.body);
      const baseResult = analyzePerformance({
        ...input,
        practiceMode: input.practiceMode,
      });

      let detailed: ReturnType<typeof buildDetailedFeedback> | null = null;
      const warnings: string[] = [];
      const verseStartSec = input.verseStartSec ?? 0;
      const verseEndSec =
        input.verseEndSec ??
        (input.referenceDurationSec ? verseStartSec + input.referenceDurationSec : verseStartSec);

      const referenceWordsInput = input.referenceWords ?? [];
      const referenceWords: WordToken[] = referenceWordsInput.map((word, index) => ({
        word: word.word,
        start: word.start,
        end: word.end,
        index,
        lineIndex: word.lineIndex,
      }));

      const referenceLines: ReferenceLine[] | undefined = input.referenceLines?.map((line) => ({
        index: line.index,
        text: line.text,
        start: line.start,
        end: line.end,
      }));

      if (input.recordingId || input.recordingUrl) {
        let recordingPath: string | undefined;
        if (input.recordingId) {
          const recording = await getRecording(input.recordingId);
          if (
            recording &&
            authMode !== "disabled" &&
            recording.userId !== getRequestUserId(req)
          ) {
            return sendError(
              res,
              req,
              403,
              "FORBIDDEN",
              "You do not have access to this recording"
            );
          }
          recordingPath = recording ? resolveAudioSource(recording) : undefined;
        }
        if (!recordingPath && input.recordingUrl) {
          recordingPath = resolveAudioSource({
            storagePath: input.recordingUrl,
            publicUrl: input.recordingUrl,
          });
        }

        if (!recordingPath) {
          return res.status(400).json({
            code: "RECORDING_NOT_FOUND",
            message: "Recording not found for analysis.",
          });
        }

        try {
          const attemptTranscript = await withRetry(
            () =>
              withTimeout(transcribeWithAssemblyAI(recordingPath, {}), 8 * 60 * 1000, "Transcription timed out"),
            { retries: 1, isRetryable: isTransientError }
          );
          const userWords: WordToken[] = attemptTranscript.words.map((word, index) => ({
            word: word.word,
            start: word.start,
            end: word.end,
            index,
          }));

          if (userWords.length === 0) {
            const lowSignal =
              input.calibrationMetrics &&
              (input.calibrationMetrics.rmsAvg < 0.01 || input.calibrationMetrics.snrDb < 9);
            detailed = {
              wordAccuracyPct: 0,
              timingMeanAbsMs: 0,
              paceRatio: 1,
              perWord: [],
              segments: [],
              coachTips: [
                lowSignal
                  ? "Low input level detected. Try again closer to the mic."
                  : "No speech detected. Try again closer to the mic.",
              ],
              nextDrill: {
                type: "accuracy_clean",
                note: lowSignal
                  ? "Increase input level and project the words clearly."
                  : "Try again closer to the mic and project the words clearly.",
              },
              subscores: {
                wordAccuracy: 0,
                timing: 0,
                pace: 0,
              },
              missedWords: [],
              extraWords: [],
              message: lowSignal
                ? "Low input level detected. Try again closer to the mic."
                : "No speech detected. Try again closer to the mic.",
            };
          } else if (referenceWords.length > 0) {
            detailed = buildDetailedFeedback({
              referenceWords,
              userWords,
              referenceLines,
              verseStartSec,
              verseEndSec,
              estimatedOffsetMs: input.estimatedOffsetMs,
            });
          } else {
            detailed = {
              wordAccuracyPct: 0,
              timingMeanAbsMs: 0,
              paceRatio: 1,
              perWord: [],
              segments: [],
              coachTips: ["Reference transcript missing. Re-transcribe the reference track."],
              nextDrill: {
                type: "accuracy_clean",
                note: "Re-run transcription to generate word-level timing.",
              },
              subscores: {
                wordAccuracy: 0,
                timing: 0,
                pace: 0,
              },
              missedWords: [],
              extraWords: [],
              message: "Reference transcript missing.",
            };
          }
        } catch (err) {
          const code =
            typeof (err as any)?.code === "string" ? (err as any).code : undefined;
          if (code === "TRANSCRIPTION_DISABLED") {
            warnings.push("Attempt transcription is disabled by server configuration.");
            detailed = null;
          }
          if (code === "ASSEMBLYAI_KEY_MISSING") {
            return sendError(res, req, 400, "ASSEMBLYAI_KEY_MISSING", "ASSEMBLYAI_API_KEY is not set");
          }
          if (code === "ASSEMBLYAI_QUOTA_EXCEEDED") {
            return sendError(
              res,
              req,
              429,
              "ASSEMBLYAI_QUOTA_EXCEEDED",
              "Transcription quota exceeded. Try manual lyrics."
            );
          }
          console.error("Attempt transcription failed:", err);
          warnings.push("Attempt transcription failed; returning basic scoring only.");
        }
      }

      if (input.debugTiming && detailed) {
        const firstRefStart = detailed.perWord[0]?.refStart ?? null;
        const firstUserStart = detailed.perWord[0]?.userStart ?? null;
        const sampleDeltas = detailed.perWord
          .map((word) => word.deltaMs)
          .filter((value): value is number => typeof value === "number")
          .slice(0, 8);
        console.log("[timing-debug]", {
          firstRefStart,
          firstUserStart,
          verseStartSec,
          computedOffset: input.estimatedOffsetMs ?? 0,
          sampleDeltas,
        });
      }

      const wordScore = detailed?.subscores?.wordAccuracy;
      let result = baseResult;
      if (typeof wordScore === "number" || input.practiceMode) {
        const overall = computeOverallScore(
          {
            pitch: baseResult.pitch,
            timing: baseResult.timing,
            stability: baseResult.stability,
            words: typeof wordScore === "number" ? wordScore : undefined,
          },
          resolveWeights(input.practiceMode)
        );
        result = {
          ...baseResult,
          overall,
          ...(typeof wordScore === "number" ? { words: wordScore } : {}),
        };
      }

      res.json({
        ...result,
        detailed,
        alignment: {
          timingCorrelation: baseResult.alignment.timingCorrelation,
          estimatedOffsetMs: input.estimatedOffsetMs,
        },
        ...(warnings.length ? { warnings } : {}),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return sendError(res, req, 400, "VALIDATION_ERROR", err.errors[0].message, {
          issues: err.errors,
        });
      } else {
        console.error(err);
        return sendError(
          res,
          req,
          500,
          "ANALYSIS_FAILED",
          "Performance analysis failed",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  });

  app.post("/api/live-coaching/attempt", requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        uploadId: z.number(),
        verseIndex: z.number(),
        verseCount: z.number(),
        scores: z.object({
          overall: z.number(),
          pitch: z.number(),
          timing: z.number(),
          stability: z.number(),
          words: z.number().optional(),
          label: z.string(),
        }),
        tips: z.array(z.string()),
        focusLine: z.string().nullable().optional(),
        focusAreas: z.array(z.string()).optional(),
        practiceMode: z.string().optional(),
        debug: z.record(z.any()).optional(),
      });

      const input = schema.parse(req.body);
      if (authMode !== "disabled") {
        const upload = await getUpload(input.uploadId);
        if (!upload || upload.userId !== getRequestUserId(req)) {
          return sendError(res, req, 403, "FORBIDDEN", "You do not have access to this upload");
        }
      }
      const saved = await saveAttempt({
        userId: getRequestUserId(req),
        uploadId: input.uploadId,
        verseIndex: input.verseIndex,
        verseCount: input.verseCount,
        scores: input.scores,
        tips: input.tips,
        focusLine: input.focusLine ?? null,
        focusAreas: input.focusAreas ?? [],
        practiceMode: input.practiceMode ?? "full",
        debug: input.debug ?? null,
      });

      res.status(201).json(saved);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return sendError(res, req, 400, "VALIDATION_ERROR", err.errors[0].message, {
          issues: err.errors,
        });
      } else {
        console.error(err);
        return sendError(res, req, 500, "ATTEMPT_SAVE_FAILED", "Failed to save attempt");
      }
    }
  });

  app.get("/api/live-coaching/history", requireAuth, async (req, res) => {
    try {
      const userId = getRequestUserId(req);
      const limitRaw = parseNumber((req.query as any)?.limit);
      const uploadId = parseNumber((req.query as any)?.uploadId);
      const offsetRaw = parseNumber((req.query as any)?.offset);
      const search =
        typeof (req.query as any)?.q === "string"
          ? (req.query as any).q
          : undefined;
      const sort =
        typeof (req.query as any)?.sort === "string" &&
        (req.query as any).sort.toLowerCase() === "asc"
          ? "asc"
          : "desc";
      const limit = Math.min(50, Math.max(1, limitRaw ?? 20));
      const offset = Math.max(0, offsetRaw ?? 0);
      const attempts = await listRecentAttempts(userId, limit, uploadId, offset, {
        search,
        sort,
      });
      res.json(attempts);
    } catch (err) {
      console.error(err);
      return sendError(res, req, 500, "HISTORY_FAILED", "Failed to load history");
    }
  });

  return httpServer;
}
