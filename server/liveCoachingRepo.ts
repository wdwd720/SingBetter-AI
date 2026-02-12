import { db } from "./db";
import {
  liveCoachingUploads,
  liveCoachingRecordings,
  liveCoachingAttempts,
  type InsertLiveCoachingUpload,
  type InsertLiveCoachingRecording,
  type InsertLiveCoachingAttempt,
} from "@shared/schema";
import { desc, eq, and } from "drizzle-orm";
import * as jsonStore from "./liveCoachingStore";
import { invalidateProgressCache } from "./storage";
import type {
  CoachingAttempt,
  CoachingRecording,
  CoachingUpload,
} from "./liveCoachingStore";

const useJsonStore = !db || process.env.USE_JSON_DB?.toLowerCase() === "true";

const formatCreatedAt = (value: unknown): string => {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  return new Date().toISOString();
};

const mapUpload = (row: any): CoachingUpload => ({
  id: row.id ?? row.upload_id,
  userId: row.userId ?? row.user_id,
  filename: row.filename ?? row.file_name,
  storagePath: row.storagePath ?? row.storage_path,
  publicUrl: row.publicUrl ?? row.public_url,
  mimeType: row.mimeType ?? row.mime_type,
  size: row.size ?? 0,
  createdAt: formatCreatedAt(row.createdAt ?? row.created_at),
});

const mapRecording = (row: any): CoachingRecording => ({
  id: row.id ?? row.recording_id,
  userId: row.userId ?? row.user_id,
  filename: row.filename ?? row.file_name,
  storagePath: row.storagePath ?? row.storage_path,
  publicUrl: row.publicUrl ?? row.public_url,
  mimeType: row.mimeType ?? row.mime_type,
  size: row.size ?? 0,
  durationSec: row.durationSec ?? row.duration_sec ?? 0,
  createdAt: formatCreatedAt(row.createdAt ?? row.created_at),
});

const parseArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapAttempt = (row: any): CoachingAttempt => ({
  id: row.id ?? row.attempt_id,
  userId: row.userId ?? row.user_id,
  uploadId: row.uploadId ?? row.upload_id,
  verseIndex: row.verseIndex ?? row.verse_index ?? 0,
  verseCount: row.verseCount ?? row.verse_count ?? 1,
  scores: {
    overall: row.scoreOverall ?? row.score_overall ?? 0,
    pitch: row.scorePitch ?? row.score_pitch ?? 0,
    timing: row.scoreTiming ?? row.score_timing ?? 0,
    stability: row.scoreStability ?? row.score_stability ?? 0,
    words: row.scoreWords ?? row.score_words ?? 0,
    label: row.scoreLabel ?? row.score_label ?? "Performance",
  },
  tips: parseArray(row.tips),
  focusLine: row.focusLine ?? row.focus_line ?? null,
  focusAreas: parseArray(row.focusAreas ?? row.focus_areas),
  practiceMode: row.practiceMode ?? row.practice_mode ?? "full",
  debug: row.debug ?? null,
  createdAt: formatCreatedAt(row.createdAt ?? row.created_at),
});

export async function saveUpload(
  upload: Omit<CoachingUpload, "id" | "createdAt">
): Promise<CoachingUpload> {
  if (useJsonStore) {
    const saved = jsonStore.saveUpload(upload);
    invalidateProgressCache();
    return saved;
  }
  const dbAny = db as any;
  const [saved] = await dbAny
    .insert(liveCoachingUploads as any)
    .values(upload as InsertLiveCoachingUpload)
    .returning();
  invalidateProgressCache();
  return mapUpload(saved);
}

export async function getUpload(id: number): Promise<CoachingUpload | undefined> {
  if (useJsonStore) {
    return jsonStore.getUpload(id);
  }
  const dbAny = db as any;
  const row = await dbAny.query.liveCoachingUploads.findFirst({
    where: eq(liveCoachingUploads.id, id),
  });
  return row ? mapUpload(row) : undefined;
}

export async function getLatestUpload(): Promise<CoachingUpload | undefined> {
  if (useJsonStore) {
    return jsonStore.getLatestUpload();
  }
  const dbAny = db as any;
  const row = await dbAny.query.liveCoachingUploads.findFirst({
    orderBy: desc(liveCoachingUploads.createdAt),
  });
  return row ? mapUpload(row) : undefined;
}

export async function getLatestUploadForUser(
  userId: string
): Promise<CoachingUpload | undefined> {
  if (useJsonStore) {
    return jsonStore.getLatestUploadForUser(userId);
  }
  const dbAny = db as any;
  const row = await dbAny.query.liveCoachingUploads.findFirst({
    where: eq(liveCoachingUploads.userId, userId),
    orderBy: desc(liveCoachingUploads.createdAt),
  });
  return row ? mapUpload(row) : undefined;
}

export async function saveRecording(
  recording: Omit<CoachingRecording, "id" | "createdAt">
): Promise<CoachingRecording> {
  if (useJsonStore) {
    const saved = jsonStore.saveRecording(recording);
    invalidateProgressCache();
    return saved;
  }
  const dbAny = db as any;
  const [saved] = await dbAny
    .insert(liveCoachingRecordings as any)
    .values(recording as InsertLiveCoachingRecording)
    .returning();
  invalidateProgressCache();
  return mapRecording(saved);
}

export async function getRecording(id: number): Promise<CoachingRecording | undefined> {
  if (useJsonStore) {
    return jsonStore.getRecording(id);
  }
  const dbAny = db as any;
  const row = await dbAny.query.liveCoachingRecordings.findFirst({
    where: eq(liveCoachingRecordings.id, id),
  });
  return row ? mapRecording(row) : undefined;
}

export async function getLatestRecording(): Promise<CoachingRecording | undefined> {
  if (useJsonStore) {
    return jsonStore.getLatestRecording();
  }
  const dbAny = db as any;
  const row = await dbAny.query.liveCoachingRecordings.findFirst({
    orderBy: desc(liveCoachingRecordings.createdAt),
  });
  return row ? mapRecording(row) : undefined;
}

export async function saveAttempt(
  attempt: Omit<CoachingAttempt, "id" | "createdAt">
): Promise<CoachingAttempt> {
  if (useJsonStore) {
    const saved = jsonStore.saveAttempt(attempt);
    invalidateProgressCache();
    return saved;
  }
  const dbAny = db as any;
  const payload: InsertLiveCoachingAttempt = {
    userId: attempt.userId,
    uploadId: attempt.uploadId,
    verseIndex: attempt.verseIndex,
    verseCount: attempt.verseCount,
    scoreOverall: attempt.scores.overall,
    scorePitch: attempt.scores.pitch,
    scoreTiming: attempt.scores.timing,
    scoreStability: attempt.scores.stability,
    scoreWords: attempt.scores.words ?? 0,
    scoreLabel: attempt.scores.label,
    tips: attempt.tips,
    focusLine: attempt.focusLine ?? null,
    focusAreas: attempt.focusAreas ?? [],
    practiceMode: attempt.practiceMode ?? "full",
    debug: attempt.debug ?? null,
  };
  const [saved] = await dbAny
    .insert(liveCoachingAttempts as any)
    .values(payload)
    .returning();
  invalidateProgressCache();
  return mapAttempt(saved);
}

export async function listRecentAttempts(
  userId: string,
  limit = 20,
  uploadId?: number,
  offset = 0,
  options?: {
    search?: string;
    sort?: "asc" | "desc";
  }
): Promise<CoachingAttempt[]> {
  const search = options?.search?.trim().toLowerCase();
  const sort = options?.sort === "asc" ? "asc" : "desc";
  if (useJsonStore) {
    const all = jsonStore.listRecentAttempts(userId, Math.max(limit + offset, 1), uploadId);
    const filtered = search
      ? all.filter(
          (attempt) =>
            attempt.tips.some((tip) => tip.toLowerCase().includes(search)) ||
            (attempt.focusLine || "").toLowerCase().includes(search) ||
            (attempt.focusAreas || []).some((area) => area.toLowerCase().includes(search)),
        )
      : all;
    const sorted = [...filtered].sort((a, b) =>
      sort === "asc"
        ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sorted.slice(offset, offset + limit);
  }
  const dbAny = db as any;
  const whereClause =
    typeof uploadId === "number" && Number.isFinite(uploadId)
      ? and(eq(liveCoachingAttempts.userId, userId), eq(liveCoachingAttempts.uploadId, uploadId))
      : eq(liveCoachingAttempts.userId, userId);
  const rows = await dbAny.query.liveCoachingAttempts.findMany({
    where: whereClause,
    orderBy: sort === "asc" ? liveCoachingAttempts.createdAt : desc(liveCoachingAttempts.createdAt),
    limit,
    offset,
  });
  const mapped = rows.map(mapAttempt);
  if (!search) return mapped;
  return mapped.filter((attempt: CoachingAttempt) => {
    const tips = attempt.tips || [];
    const focusAreas = attempt.focusAreas || [];
    return (
      tips.some((tip: string) => tip.toLowerCase().includes(search)) ||
      (attempt.focusLine || "").toLowerCase().includes(search) ||
      focusAreas.some((area: string) => area.toLowerCase().includes(search))
    );
  });
}
