import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";
import { api } from "@shared/routes";
import { z } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from "express";

// Multer setup for audio uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storageConfig = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storageConfig,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') { // webm is common for web audio recording
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'));
    }
  }
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // 1. Setup Auth
  await setupAuth(app);
  registerAuthRoutes(app);

  // Serve uploads (protected or public? stick to protected for now via API, but serving static for simplicity)
  app.use('/uploads', express.static(uploadDir));

  // 2. Session Routes
  app.post(api.sessions.create.path, isAuthenticated, async (req, res) => {
    try {
      const input = api.sessions.create.input.parse(req.body);
      const session = await storage.createSession({
        ...input,
        userId: (req.user as any).claims.sub, // From Replit Auth
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

  app.get(api.sessions.list.path, isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).claims.sub;
      const sessions = await storage.getUserSessions(userId);
      res.json(sessions);
    } catch (err) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.get(api.sessions.get.path, isAuthenticated, async (req, res) => {
    try {
      const session = await storage.getSession(Number(req.params.id));
      if (!session) return res.status(404).json({ message: "Session not found" });
      
      // Security check
      if (session.userId !== (req.user as any).claims.sub) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      
      res.json(session);
    } catch (err) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  app.post(api.sessions.finish.path, isAuthenticated, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const input = api.sessions.finish.input.parse(req.body);
      
      const session = await storage.getSession(id);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== (req.user as any).claims.sub) {
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
  app.get(api.progress.get.path, isAuthenticated, async (req, res) => {
    try {
      const userId = (req.user as any).claims.sub;
      const progress = await storage.getUserProgress(userId);
      res.json(progress);
    } catch (err) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  });

  // 4. Upload Route (Special handling for multipart)
  app.post('/api/sessions/:id/upload', isAuthenticated, upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    
    try {
      const sessionId = Number(req.params.id);
      const artifact = await storage.addAudioArtifact({
        sessionId,
        type: 'user_recording',
        storagePath: req.file.path,
        publicUrl: `/uploads/${req.file.filename}`,
        mimeType: req.file.mimetype,
      });
      
      res.json(artifact);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Upload failed" });
    }
  });

  return httpServer;
}
