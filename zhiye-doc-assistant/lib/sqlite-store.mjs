import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function openUsageStore(filename) {
  const path = filename === ":memory:" ? filename : resolve(filename);
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS public_usage (
    day TEXT PRIMARY KEY NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    minute INTEGER NOT NULL DEFAULT 0,
    minute_requests INTEGER NOT NULL DEFAULT 0
  )`);
  // The adapter preserves the shared quota API while using native SQLite.
  return {
    prepare(sql) {
      return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args) ?? null; } }; } };
    },
    close() { sqlite.close(); },
  };
}
