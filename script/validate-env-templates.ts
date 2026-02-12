import fs from "fs";
import path from "path";

const filesToValidate: Record<string, string[]> = {
  ".env.example": [
    "DATABASE_URL",
    "SESSION_SECRET",
    "DISABLE_AUTH",
    "AUTH_PROVIDER",
    "UPLOADS_DRIVER",
    "UPLOAD_SCAN_MODE",
    "CORS_ALLOWED_ORIGINS",
  ],
  ".env.development.example": [
    "DATABASE_URL",
    "DISABLE_AUTH",
    "AUTH_PROVIDER",
    "SESSION_SECRET",
  ],
  ".env.staging.example": [
    "NODE_ENV",
    "RELEASE_MODE",
    "DATABASE_URL",
    "SESSION_SECRET",
    "UPLOADS_DRIVER",
  ],
  ".env.production.example": [
    "NODE_ENV",
    "RELEASE_MODE",
    "DATABASE_URL",
    "SESSION_SECRET",
    "DISABLE_AUTH",
    "UPLOADS_DRIVER",
    "UPLOAD_SCAN_MODE",
  ],
};

const keyRegex = /^([A-Z0-9_]+)\s*=/;

const readKeys = (filePath: string): Set<string> => {
  const content = fs.readFileSync(filePath, "utf8");
  const keys = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(keyRegex);
    if (match) {
      keys.add(match[1]);
    }
  }
  return keys;
};

const failures: string[] = [];

for (const [relativeFile, requiredKeys] of Object.entries(filesToValidate)) {
  const filePath = path.join(process.cwd(), relativeFile);
  if (!fs.existsSync(filePath)) {
    failures.push(`${relativeFile}: file is missing`);
    continue;
  }

  const keys = readKeys(filePath);
  for (const key of requiredKeys) {
    if (!keys.has(key)) {
      failures.push(`${relativeFile}: missing ${key}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Environment template validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Environment templates validated.");
