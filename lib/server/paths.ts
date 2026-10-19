import "server-only";

import path from "node:path";

export function projectRoot(): string {
  return process.cwd();
}

export function dataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(projectRoot(), ".data");
}

/** SQLite database file. All app state lives here; legacy JSON files are ignored. */
export function databaseFile(): string {
  return path.join(dataDir(), "history-atlas.db");
}

export function seedAssetsDir(): string {
  return path.join(projectRoot(), "assets");
}

