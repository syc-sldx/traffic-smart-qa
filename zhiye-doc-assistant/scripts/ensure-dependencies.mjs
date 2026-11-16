// Keeps the existing Render build command (`npm test`) compatible after adding
// runtime parsers. Install only when the lockfile changed or modules are absent.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = readFileSync(resolve(root, "package-lock.json"));
const hash = createHash("sha256").update(lock).digest("hex");
const marker = resolve(root, "node_modules/.zhiye-lock-hash");
const ready = existsSync(marker) && readFileSync(marker, "utf8").trim() === hash && existsSync(resolve(root, "node_modules/officeparser/package.json"));
if (!ready) {
  if (!process.env.npm_execpath) throw new Error("Install with npm ci before running tests directly.");
  const result = spawnSync(process.execPath, [process.env.npm_execpath, "ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
  writeFileSync(marker, hash);
}
