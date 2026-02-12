import fs from "fs";
import path from "path";

const source = path.join(process.cwd(), "dev.db");
const backupDir = path.join(process.cwd(), "backups");

if (!fs.existsSync(source)) {
  console.error("dev.db was not found. Run the app once before creating backups.");
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupDir, `dev-${timestamp}.db`);
fs.copyFileSync(source, destination);
console.log(`Backup created: ${destination}`);
