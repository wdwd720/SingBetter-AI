import fs from "fs";
import path from "path";

export type CoachingUpload = {
  id: number;
  userId: string;
  filename: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

export type CoachingAttempt = {
  id: number;
  userId: string;
  uploadId: number;
  verseIndex: number;
  verseCount: number;
  scores: {
    overall: number;
    pitch: number;
    timing: number;
    stability: number;
    words?: number;
    label: string;
  };
  tips: string[];
  focusLine?: string | null;
  focusAreas?: string[];
  practiceMode?: string;
  debug?: Record<string, any> | null;
  createdAt: string;
};

export type CoachingRecording = {
  id: number;
  userId: string;
  filename: string;
  storagePath: string;
  publicUrl: string;
  mimeType: string;
  size: number;
  durationSec: number;
  createdAt: string;
};

type LiveCoachingDb = {
  uploads: CoachingUpload[];
  attempts: CoachingAttempt[];
  recordings: CoachingRecording[];
};

const storePath = path.join(process.cwd(), "server", "data", "live-coaching.json");

function loadStore(): LiveCoachingDb {
  if (!fs.existsSync(storePath)) {
    return { uploads: [], attempts: [], recordings: [] };
  }
  const raw = fs.readFileSync(storePath, "utf-8");
  const parsed = JSON.parse(raw) as LiveCoachingDb;
  return {
    uploads: parsed.uploads || [],
    attempts: parsed.attempts || [],
    recordings: parsed.recordings || [],
  };
}

function saveStore(data: LiveCoachingDb) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), "utf-8");
}

function nextId(items: Array<{ id: number }>): number {
  if (items.length === 0) return 1;
  return Math.max(...items.map((item) => item.id)) + 1;
}

export function saveUpload(
  upload: Omit<CoachingUpload, "id" | "createdAt">
): CoachingUpload {
  const data = loadStore();
  const saved: CoachingUpload = {
    ...upload,
    id: nextId(data.uploads),
    createdAt: new Date().toISOString(),
  };
  data.uploads.push(saved);
  saveStore(data);
  return saved;
}

export function getUpload(id: number): CoachingUpload | undefined {
  const data = loadStore();
  return data.uploads.find((upload) => upload.id === id);
}

export function getLatestUpload(): CoachingUpload | undefined {
  const data = loadStore();
  if (data.uploads.length === 0) return undefined;
  return data.uploads.reduce((latest, upload) =>
    upload.id > latest.id ? upload : latest
  );
}

export function getLatestUploadForUser(userId: string): CoachingUpload | undefined {
  const data = loadStore();
  const uploads = data.uploads.filter((upload) => upload.userId === userId);
  if (uploads.length === 0) return undefined;
  return uploads.reduce((latest, upload) =>
    upload.id > latest.id ? upload : latest
  );
}

export function saveAttempt(
  attempt: Omit<CoachingAttempt, "id" | "createdAt">
): CoachingAttempt {
  const data = loadStore();
  const saved: CoachingAttempt = {
    ...attempt,
    id: nextId(data.attempts),
    createdAt: new Date().toISOString(),
  };
  data.attempts.push(saved);
  saveStore(data);
  return saved;
}

export function listAttemptsForUpload(uploadId: number): CoachingAttempt[] {
  const data = loadStore();
  return data.attempts.filter((attempt) => attempt.uploadId === uploadId);
}

export function listRecentAttempts(
  userId: string,
  limit = 20,
  uploadId?: number
): CoachingAttempt[] {
  const data = loadStore();
  let attempts = data.attempts.filter((attempt) => attempt.userId === userId);
  if (typeof uploadId === "number" && Number.isFinite(uploadId)) {
    attempts = attempts.filter((attempt) => attempt.uploadId === uploadId);
  }
  return attempts
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, Math.max(1, limit));
}

export function saveRecording(
  recording: Omit<CoachingRecording, "id" | "createdAt">
): CoachingRecording {
  const data = loadStore();
  const saved: CoachingRecording = {
    ...recording,
    id: nextId(data.recordings),
    createdAt: new Date().toISOString(),
  };
  data.recordings.push(saved);
  saveStore(data);
  return saved;
}

export function getRecording(id: number): CoachingRecording | undefined {
  const data = loadStore();
  return data.recordings.find((recording) => recording.id === id);
}

export function getLatestRecording(): CoachingRecording | undefined {
  const data = loadStore();
  if (data.recordings.length === 0) return undefined;
  return data.recordings.reduce((latest, recording) =>
    recording.id > latest.id ? recording : latest
  );
}
