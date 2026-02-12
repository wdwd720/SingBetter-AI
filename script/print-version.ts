import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

type PackageJson = {
  version?: string;
};

const pkgPath = path.join(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as PackageJson;
const version = pkg.version ?? "0.0.0";

const commitFromEnv =
  process.env.APP_COMMIT_SHA?.trim() || process.env.GIT_COMMIT_SHA?.trim() || "";

let commit = commitFromEnv;
if (!commit) {
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  if (git.status === 0 && git.stdout) {
    commit = git.stdout.trim();
  }
}

if (!commit) {
  commit = "unknown";
}

console.log(`version=${version}`);
console.log(`commit=${commit}`);
console.log(`node=${process.version}`);
