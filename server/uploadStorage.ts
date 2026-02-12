import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, { type Express } from "express";
import multer from "multer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ApiError } from "./lib/http";

type UploadDriver = "local" | "s3";

type S3RuntimeConfig = {
  client: S3Client;
  bucket: string;
  publicBaseUrl: string;
};

type StoredUpload = {
  storagePath: string;
  publicUrl: string;
  transcriptionSource: string;
};

const uploadDir = path.resolve(process.env.UPLOADS_DIR?.trim() || path.join(process.cwd(), "uploads"));
const maxUploadSizeBytes = 20 * 1024 * 1024;
const uploadScanMode = process.env.UPLOAD_SCAN_MODE?.trim().toLowerCase() || "basic";
const allowedExtensions = new Set([
  ".mp3",
  ".wav",
  ".webm",
  ".m4a",
  ".flac",
  ".ogg",
  ".aac",
]);
const allowedMimePrefixes = ["audio/"];
const allowedExactMimeTypes = new Set([
  "video/webm",
  "audio/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
  "audio/ogg",
  "audio/x-m4a",
]);

const uploadDriver: UploadDriver =
  process.env.UPLOADS_DRIVER?.trim().toLowerCase() === "s3" ? "s3" : "local";

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const normalizePublicBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const sanitizeOriginalName = (name: string): string => {
  const ext = path.extname(name).toLowerCase();
  const base = path
    .basename(name, ext)
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const fallback = base.length > 0 ? base : "audio";
  return `${fallback}${ext}`;
};

const buildStorageKey = (originalName: string): string => {
  const safe = sanitizeOriginalName(originalName);
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return `audio/${unique}-${safe}`;
};

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();
  const hasAllowedExt = allowedExtensions.has(ext);
  const hasAllowedMime =
    allowedExactMimeTypes.has(mime) ||
    allowedMimePrefixes.some((prefix) => mime.startsWith(prefix));

  if (!hasAllowedExt) {
    cb(new Error("Unsupported file extension"));
    return;
  }
  if (!hasAllowedMime) {
    cb(new Error("Only audio files are allowed"));
    return;
  }
  cb(null, true);
};

const containsEicar = (content: Buffer): boolean => {
  const marker = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  return content.toString("utf8").includes(marker);
};

const hasAllowedMagic = (content: Buffer): boolean => {
  if (content.length < 4) return false;
  const asHex = content.subarray(0, 16).toString("hex");
  return (
    asHex.startsWith("52494646") || // RIFF
    asHex.startsWith("1a45dfa3") || // webm
    asHex.startsWith("494433") || // mp3 ID3
    asHex.startsWith("fffb") || // mp3 frame
    asHex.startsWith("664c6143") || // flac
    asHex.startsWith("4f676753") || // ogg
    asHex.startsWith("66747970") // mp4/m4a ftyp
  );
};

const scanUpload = async (file: Express.Multer.File): Promise<void> => {
  if (uploadScanMode === "off") return;
  const payload = file.buffer
    ? file.buffer
    : file.path && fs.existsSync(file.path)
      ? fs.readFileSync(file.path)
      : null;
  if (!payload) {
    throw new ApiError(400, "UPLOAD_SCAN_FAILED", "Uploaded file could not be scanned");
  }
  if (containsEicar(payload)) {
    throw new ApiError(400, "UPLOAD_SCAN_BLOCKED", "Upload blocked by malware signature check");
  }
  if (uploadScanMode === "strict" && !hasAllowedMagic(payload)) {
    throw new ApiError(400, "UPLOAD_SCAN_BLOCKED", "Upload file header did not match allowed audio formats");
  }
};

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const safe = sanitizeOriginalName(file.originalname || "audio");
    const key = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safe}`;
    cb(null, key);
  },
});

let cachedS3Config: S3RuntimeConfig | null = null;

const getS3Config = (): S3RuntimeConfig => {
  if (cachedS3Config) return cachedS3Config;

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const region = process.env.S3_REGION?.trim() || "auto";
  const publicBaseRaw = process.env.PUBLIC_UPLOADS_BASE_URL?.trim();

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new ApiError(
      500,
      "UPLOADS_CONFIG_INVALID",
      "S3 upload driver is enabled but S3 credentials are missing",
    );
  }

  const client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    ...(endpoint
      ? {
          endpoint,
          forcePathStyle: true,
        }
      : {}),
  });

  const publicBaseUrl = publicBaseRaw
    ? normalizePublicBaseUrl(publicBaseRaw)
    : endpoint
      ? `${normalizePublicBaseUrl(endpoint)}/${bucket}`
      : `https://${bucket}.s3.${region}.amazonaws.com`;

  cachedS3Config = {
    client,
    bucket,
    publicBaseUrl,
  };

  return cachedS3Config;
};

const uploadStorageEngine =
  uploadDriver === "s3" ? multer.memoryStorage() : diskStorage;

export const upload = multer({
  storage: uploadStorageEngine,
  limits: { fileSize: maxUploadSizeBytes },
  fileFilter,
});

export const getUploadDriver = (): UploadDriver => uploadDriver;

export const mountUploadStatic = (app: Express): void => {
  if (uploadDriver !== "local") return;
  fs.mkdirSync(uploadDir, { recursive: true });
  app.use(
    "/uploads",
    express.static(uploadDir, {
      setHeaders: (res) => {
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("cross-origin-resource-policy", "same-site");
        res.setHeader(
          "content-security-policy",
          "default-src 'none'; img-src 'self'; media-src 'self'; script-src 'none'; style-src 'none'",
        );
      },
    }),
  );
};

export const persistUploadedFile = async (
  file: Express.Multer.File,
): Promise<StoredUpload> => {
  try {
    await scanUpload(file);
  } catch (error) {
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    throw error;
  }

  if (uploadDriver === "local") {
    if (!file.path || !file.filename) {
      throw new ApiError(500, "UPLOAD_WRITE_FAILED", "Local file upload failed");
    }
    const absolutePath = path.isAbsolute(file.path)
      ? file.path
      : path.join(process.cwd(), file.path);
    return {
      storagePath: absolutePath,
      publicUrl: `/uploads/${file.filename}`,
      transcriptionSource: absolutePath,
    };
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw new ApiError(400, "UPLOAD_MISSING", "No file uploaded");
  }

  const { client, bucket, publicBaseUrl } = getS3Config();
  const key = buildStorageKey(file.originalname || "audio");

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype || "application/octet-stream",
    }),
  );

  const publicUrl = `${publicBaseUrl}/${encodeURI(key)}`;
  return {
    storagePath: key,
    publicUrl,
    transcriptionSource: publicUrl,
  };
};

export const resolveAudioSource = (input: {
  storagePath?: string | null;
  publicUrl?: string | null;
}): string | undefined => {
  const storagePath = input.storagePath?.trim();
  const publicUrl = input.publicUrl?.trim();

  if (storagePath && isHttpUrl(storagePath)) return storagePath;
  if (publicUrl && isHttpUrl(publicUrl)) return publicUrl;

  if (uploadDriver === "s3") {
    if (!storagePath) return undefined;
    const key = storagePath.replace(/^s3:\/\//i, "").replace(/^\/+/, "");
    const { publicBaseUrl } = getS3Config();
    return `${publicBaseUrl}/${encodeURI(key)}`;
  }

  if (storagePath) {
    if (path.isAbsolute(storagePath)) return storagePath;
    return path.join(process.cwd(), storagePath.replace(/^\/+/, ""));
  }

  if (publicUrl && publicUrl.startsWith("/uploads/")) {
    return path.join(process.cwd(), publicUrl.replace(/^\/+/, ""));
  }

  return undefined;
};

export const getUploadStorageStatus = (): {
  driver: UploadDriver;
  healthy: boolean;
  message?: string;
} => {
  if (uploadDriver === "local") {
    return {
      driver: "local",
      healthy: true,
      message: uploadDir,
    };
  }

  const missing: string[] = [];
  if (!process.env.S3_BUCKET?.trim()) missing.push("S3_BUCKET");
  if (!process.env.S3_ACCESS_KEY_ID?.trim()) missing.push("S3_ACCESS_KEY_ID");
  if (!process.env.S3_SECRET_ACCESS_KEY?.trim()) missing.push("S3_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    return {
      driver: "s3",
      healthy: false,
      message: `Missing env vars: ${missing.join(", ")}`,
    };
  }

  return {
    driver: "s3",
    healthy: true,
  };
};
