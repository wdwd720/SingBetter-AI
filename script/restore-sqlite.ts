import fs from "fs";
import path from "path";

const backupPath = process.argv[2];

if (!backupPath) {
  console.error("Usage: npm run restore:sqlite -- <path-to-backup.db>");
  process.exit(1);
}

const resolvedBackup = path.isAbsolute(backupPath)
  ? backupPath
  : path.join(process.cwd(), backupPath);

if (!fs.existsSync(resolvedBackup)) {
  console.error(`Backup file not found: ${resolvedBackup}`);
  process.exit(1);
}

const destination = path.join(process.cwd(), "dev.db");
fs.copyFileSync(resolvedBackup, destination);
console.log(`Restored dev.db from ${resolvedBackup}`);
