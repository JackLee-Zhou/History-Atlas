import "server-only";

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  analysisSchema,
  bookSchema,
  chapterSchema,
  correctionSchema,
  overviewSchema,
  storedSettingsSchema,
  type Analysis,
  type Book,
  type Chapter,
  type Correction,
  type Overview,
  type SettingsView,
  type SettingsUpdate,
  type StoredSettings,
} from "@/lib/schema";
import { dataDir, databaseFile } from "./paths";
import { MAX_CACHE_BYTES } from "@/lib/constants";
import { normalizeLlmBaseUrl } from "@/lib/llm/url";

const storedBookSchema = z.object({
  book: bookSchema,
  chapters: z.array(chapterSchema).min(1),
});

export type StoredBook = z.infer<typeof storedBookSchema>;

/* ------------------------------------------------------------------ */
/* Database bootstrap                                                  */
/* ------------------------------------------------------------------ */

interface DatabaseGlobal {
  __historyAtlasDb?: DatabaseSync;
}

const databaseGlobal = globalThis as unknown as DatabaseGlobal;

function transaction<T>(db: DatabaseSync, task: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function initializeDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      format TEXT NOT NULL,
      data TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS analyses_book_chapter_created
      ON analyses(book_id, chapter_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS analyses_created
      ON analyses(created_at DESC);

    CREATE TABLE IF NOT EXISTS analysis_cache (
      key TEXT PRIMARY KEY,
      book_id TEXT,
      chapter_id TEXT,
      data TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS corrections (
      id TEXT PRIMARY KEY,
      book_id TEXT,
      ancient_name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS corrections_book_name
      ON corrections(book_id, ancient_name);

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS overviews (
      key TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS overviews_book_chapter
      ON overviews(book_id, chapter_id, created_at DESC);
  `);

  // Lightweight migration for databases created before cache rows were scoped
  // to a book/chapter. Existing rows remain readable by key but are not hit by
  // the new scoped keys and will be evicted normally.
  const cacheColumns = db
    .prepare("PRAGMA table_info(analysis_cache)")
    .all() as Array<{ name: string }>;
  const cacheColumnNames = new Set(cacheColumns.map((column) => column.name));
  if (!cacheColumnNames.has("book_id")) {
    db.exec("ALTER TABLE analysis_cache ADD COLUMN book_id TEXT");
  }
  if (!cacheColumnNames.has("chapter_id")) {
    db.exec("ALTER TABLE analysis_cache ADD COLUMN chapter_id TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS analysis_cache_book ON analysis_cache(book_id, chapter_id)",
  );
  db.exec("PRAGMA user_version = 2");
}

export function closeDatabase(): void {
  databaseGlobal.__historyAtlasDb?.close();
  delete databaseGlobal.__historyAtlasDb;
}

export function getDatabase(): DatabaseSync {
  if (databaseGlobal.__historyAtlasDb) return databaseGlobal.__historyAtlasDb;
  fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dataDir(), 0o700);
  } catch {
    // best effort on platforms without POSIX modes
  }
  const db = new DatabaseSync(databaseFile());
  initializeDatabase(db);
  try {
    fs.chmodSync(databaseFile(), 0o600);
  } catch {
    // best effort
  }
  databaseGlobal.__historyAtlasDb = db;
  return db;
}

function parseBookRow(row: unknown): StoredBook | null {
  if (!row || typeof row !== "object") return null;
  const data = (row as { data?: unknown }).data;
  if (typeof data !== "string") return null;
  try {
    const parsed = storedBookSchema.safeParse(JSON.parse(data) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseAnalysisRow(row: unknown): Analysis | null {
  if (!row || typeof row !== "object") return null;
  const data = (row as { data?: unknown }).data;
  if (typeof data !== "string") return null;
  try {
    const parsed = analysisSchema.safeParse(JSON.parse(data) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseCorrectionRow(row: unknown): Correction | null {
  if (!row || typeof row !== "object") return null;
  const data = (row as { data?: unknown }).data;
  if (typeof data !== "string") return null;
  try {
    const parsed = correctionSchema.safeParse(JSON.parse(data) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface StoreCounts {
  books: number;
  analyses: number;
  corrections: number;
  cacheBytes: number;
}

export async function getStoreCounts(): Promise<StoreCounts> {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT
        (SELECT COUNT(*) FROM books) AS books,
        (SELECT COUNT(*) FROM analyses) AS analyses,
        (SELECT COUNT(*) FROM corrections) AS corrections,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM analysis_cache) AS cacheBytes
    `)
    .get() as
    | { books: number; analyses: number; corrections: number; cacheBytes: number }
    | undefined;
  return {
    books: Number(row?.books ?? 0),
    analyses: Number(row?.analyses ?? 0),
    corrections: Number(row?.corrections ?? 0),
    cacheBytes: Number(row?.cacheBytes ?? 0),
  };
}

export async function pingDatabase(): Promise<void> {
  getDatabase().prepare("SELECT 1").get();
}

/* ------------------------------------------------------------------ */
/* Books                                                               */
/* ------------------------------------------------------------------ */

export async function listBooks(): Promise<Book[]> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT data FROM books ORDER BY imported_at DESC")
    .all();
  const books: Book[] = [];
  for (const row of rows) {
    const parsed = parseBookRow(row);
    if (parsed) books.push(parsed.book);
  }
  return books;
}

export async function getStoredBook(id: string): Promise<StoredBook | null> {
  const db = getDatabase();
  const row = db
    .prepare("SELECT data FROM books WHERE id = ?")
    .get(id);
  return parseBookRow(row);
}

export async function getBook(id: string): Promise<Book | null> {
  const stored = await getStoredBook(id);
  return stored?.book ?? null;
}

export async function getChapter(
  bookId: string,
  chapterId: string,
): Promise<Chapter | null> {
  const stored = await getStoredBook(bookId);
  return stored?.chapters.find((chapter) => chapter.id === chapterId) ?? null;
}

export async function saveStoredBook(input: {
  book: Book;
  chapters: Chapter[];
}): Promise<StoredBook> {
  const parsed = storedBookSchema.parse(input);
  for (const chapter of parsed.chapters) {
    if (chapter.bookId !== parsed.book.id) {
      throw new Error(
        `chapter ${chapter.id} does not belong to ${parsed.book.id}`,
      );
    }
  }
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO books (id, title, author, format, data, imported_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      format = excluded.format,
      data = excluded.data,
      imported_at = excluded.imported_at,
      updated_at = excluded.updated_at
  `).run(
    parsed.book.id,
    parsed.book.title,
    parsed.book.author ?? null,
    parsed.book.format,
    JSON.stringify(parsed),
    parsed.book.importedAt,
    now,
  );
  return parsed;
}

export async function deleteBook(id: string): Promise<void> {
  const db = getDatabase();
  transaction(db, () => {
    db.prepare("DELETE FROM books WHERE id = ?").run(id);
    db.prepare("DELETE FROM analyses WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM corrections WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM analysis_cache WHERE book_id = ?").run(id);
    db.prepare("DELETE FROM overviews WHERE book_id = ?").run(id);
  });
}

/* ------------------------------------------------------------------ */
/* Analyses                                                            */
/* ------------------------------------------------------------------ */

export async function saveAnalysis(analysis: Analysis): Promise<void> {
  const parsed = analysisSchema.parse(analysis);
  const db = getDatabase();
  db.prepare(`
    INSERT INTO analyses (id, book_id, chapter_id, scope, created_at, data)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      book_id = excluded.book_id,
      chapter_id = excluded.chapter_id,
      scope = excluded.scope,
      created_at = excluded.created_at,
      data = excluded.data
  `).run(
    parsed.id,
    parsed.bookId,
    parsed.chapterId,
    parsed.scope,
    parsed.meta.createdAt,
    JSON.stringify(parsed),
  );
}

export async function getAnalysis(id: string): Promise<Analysis | null> {
  const db = getDatabase();
  const row = db
    .prepare("SELECT data FROM analyses WHERE id = ?")
    .get(id);
  return parseAnalysisRow(row);
}

export async function getLatestAnalysisForChapter(
  bookId: string,
  chapterId: string,
): Promise<Analysis | null> {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT data FROM analyses WHERE book_id = ? AND chapter_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(bookId, chapterId);
  return parseAnalysisRow(row);
}

/* ------------------------------------------------------------------ */
/* Cache                                                               */
/* ------------------------------------------------------------------ */

export async function getCachedAnalysis(key: string): Promise<Analysis | null> {
  if (!/^[a-f0-9]{64}$/.test(key)) return null;
  const db = getDatabase();
  const row = db
    .prepare("SELECT data FROM analysis_cache WHERE key = ?")
    .get(key);
  return parseAnalysisRow(row);
}

export async function setCachedAnalysis(
  key: string,
  analysis: Analysis,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid cache key");
  const parsed = analysisSchema.parse(analysis);
  const data = JSON.stringify(parsed);
  const db = getDatabase();
  const size = Buffer.byteLength(data, "utf8");
  db.prepare(`
    INSERT INTO analysis_cache (key, book_id, chapter_id, data, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      book_id = excluded.book_id,
      chapter_id = excluded.chapter_id,
      data = excluded.data,
      size_bytes = excluded.size_bytes,
      created_at = excluded.created_at
  `).run(
    key,
    parsed.bookId,
    parsed.chapterId,
    data,
    size,
    new Date().toISOString(),
  );

  // Keep the local cache bounded; evict oldest rows first.
  const total =
    (db
      .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM analysis_cache")
      .get() as { total: number } | undefined)?.total ?? 0;
  if (total > MAX_CACHE_BYTES) {
    const rows = db
      .prepare(
        "SELECT key, size_bytes FROM analysis_cache ORDER BY created_at ASC",
      )
      .all() as Array<{ key: string; size_bytes: number }>;
    const remove = db.prepare("DELETE FROM analysis_cache WHERE key = ?");
    transaction(db, () => {
      let remaining = total;
      for (const row of rows) {
        if (remaining <= MAX_CACHE_BYTES) break;
        remove.run(row.key);
        remaining -= row.size_bytes;
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Overview cache                                                      */
/* ------------------------------------------------------------------ */

function parseOverviewRow(row: unknown): Overview | null {
  if (!row || typeof row !== "object") return null;
  const data = (row as { data?: unknown }).data;
  if (typeof data !== "string") return null;
  try {
    const parsed = overviewSchema.safeParse(JSON.parse(data) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getCachedOverview(key: string): Promise<Overview | null> {
  if (!/^[a-f0-9]{64}$/.test(key)) return null;
  const db = getDatabase();
  const row = db
    .prepare("SELECT data FROM overviews WHERE key = ?")
    .get(key);
  return parseOverviewRow(row);
}

export async function setCachedOverview(
  key: string,
  bookId: string,
  chapterId: string,
  overview: Overview,
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("invalid overview cache key");
  const parsed = overviewSchema.parse(overview);
  const db = getDatabase();
  db.prepare(`
    INSERT INTO overviews (key, book_id, chapter_id, created_at, data)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      book_id = excluded.book_id,
      chapter_id = excluded.chapter_id,
      created_at = excluded.created_at,
      data = excluded.data
  `).run(key, bookId, chapterId, new Date().toISOString(), JSON.stringify(parsed));
}

/* ------------------------------------------------------------------ */
/* Corrections                                                         */
/* ------------------------------------------------------------------ */

export async function listCorrections(): Promise<Correction[]> {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT data FROM corrections ORDER BY created_at DESC")
    .all();
  const corrections: Correction[] = [];
  for (const row of rows) {
    const parsed = parseCorrectionRow(row);
    if (parsed) corrections.push(parsed);
  }
  return corrections;
}

export async function addCorrection(
  input: Omit<Correction, "id" | "createdAt">,
): Promise<Correction> {
  const correction = correctionSchema.parse({
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const db = getDatabase();
  transaction(db, () => {
    db.prepare(
      "DELETE FROM corrections WHERE ancient_name = ? AND COALESCE(book_id, '') = ?",
    ).run(correction.ancientName, correction.bookId ?? "");
    db.prepare(
      "INSERT INTO corrections (id, book_id, ancient_name, data, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      correction.id,
      correction.bookId ?? null,
      correction.ancientName,
      JSON.stringify(correction),
      correction.createdAt,
    );
    if (correction.bookId) {
      db.prepare("DELETE FROM analysis_cache WHERE book_id = ?").run(
        correction.bookId,
      );
    }
  });
  return correction;
}

export async function deleteCorrection(id: string): Promise<void> {
  const db = getDatabase();
  db.prepare("DELETE FROM corrections WHERE id = ?").run(id);
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS: StoredSettings = {
  provider: "rule",
  geocoder: "none",
  autoAnalyze: false,
};

function envSettings(): StoredSettings {
  const providerRaw = process.env.LLM_PROVIDER?.trim();
  const provider =
    providerRaw === "openai" ||
    providerRaw === "ollama" ||
    providerRaw === "mock" ||
    providerRaw === "rule"
      ? providerRaw
      : "rule";
  return {
    provider,
    baseUrl: process.env.LLM_BASE_URL?.trim() || undefined,
    model: process.env.LLM_MODEL?.trim() || undefined,
    apiKey: process.env.LLM_API_KEY?.trim() || undefined,
    geocoder: process.env.GEOCODER === "nominatim" ? "nominatim" : "none",
    autoAnalyze: process.env.AUTO_ANALYZE === "1",
  };
}

export async function readStoredSettings(): Promise<StoredSettings | null> {
  const db = getDatabase();
  const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
  if (!row || typeof row !== "object") return null;
  const data = (row as { data?: unknown }).data;
  if (typeof data !== "string") return null;
  try {
    const parsed = storedSettingsSchema.safeParse(JSON.parse(data) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Precedence: user settings saved via the UI > environment variables > rule mode.
 * An explicitly cleared key is stored as "" so it does not silently fall back
 * to an environment key.
 */
export async function getEffectiveSettings(): Promise<StoredSettings> {
  const stored = await readStoredSettings();
  const env = envSettings();
  if (!stored) return { ...DEFAULT_SETTINGS, ...env };
  const merged: StoredSettings = { ...DEFAULT_SETTINGS, ...env, ...stored };
  if (Object.prototype.hasOwnProperty.call(stored, "apiKey")) {
    merged.apiKey = stored.apiKey;
  }
  return merged;
}

export function maskKey(key?: string): string | undefined {
  const value = key?.trim();
  if (!value) return undefined;
  if (value.length <= 8) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}

export async function getSettingsView(): Promise<SettingsView> {
  const settings = await getEffectiveSettings();
  const hasKey = Boolean(settings.apiKey?.trim());
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasKey,
    keyMasked: hasKey ? maskKey(settings.apiKey) : undefined,
    geocoder: settings.geocoder,
    autoAnalyze: settings.autoAnalyze,
  };
}

function writeStoredSettings(settings: StoredSettings): void {
  const parsed = storedSettingsSchema.parse(settings);
  const db = getDatabase();
  db.prepare(`
    INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(JSON.stringify(parsed), new Date().toISOString());
}

export async function updateSettings(
  update: SettingsUpdate,
): Promise<SettingsView> {
  const stored = await readStoredSettings();
  const current = await getEffectiveSettings();
  const requestedBaseUrl =
    update.baseUrl === undefined ? current.baseUrl : update.baseUrl.trim();
  const normalizedBaseUrl = await normalizeLlmBaseUrl(
    requestedBaseUrl,
    update.provider,
  );
  const baseChanged =
    (current.baseUrl ?? "").trim().replace(/\/+$/, "") !== normalizedBaseUrl;

  const next: StoredSettings = {
    ...current,
    provider: update.provider,
    baseUrl: normalizedBaseUrl,
    model:
      update.model === undefined ? current.model : update.model.trim(),
    geocoder: update.geocoder ?? current.geocoder,
    autoAnalyze: update.autoAnalyze ?? current.autoAnalyze,
  };

  if (update.apiKey !== undefined && update.apiKey.trim() !== "") {
    next.apiKey = update.apiKey.trim();
  } else if (baseChanged) {
    // Never reuse a stored key for a different endpoint.
    next.apiKey = "";
  } else if (stored && Object.prototype.hasOwnProperty.call(stored, "apiKey")) {
    next.apiKey = stored.apiKey;
  } else {
    // Do not copy an env-provided key into SQLite just because another field
    // was saved; it remains an env fallback.
    delete next.apiKey;
  }

  writeStoredSettings(next);
  return getSettingsView();
}

export async function clearApiKey(): Promise<SettingsView> {
  const current = await getEffectiveSettings();
  writeStoredSettings({ ...current, apiKey: "" });
  return getSettingsView();
}

/* ------------------------------------------------------------------ */
/* Analysis mutations (user corrections)                               */
/* ------------------------------------------------------------------ */

export async function updateAnalysisPlaceLocation(
  analysisId: string,
  placeId: string,
  location: {
    lat: number;
    lng: number;
    precision: "site" | "county" | "city";
    confidence: number;
    radiusKm: number;
  },
): Promise<Analysis> {
  const analysis = await getAnalysis(analysisId);
  if (!analysis) {
    throw new Error(`analysis ${analysisId} not found`);
  }
  let found = false;
  const places = analysis.situation.places.map((place) => {
    if (place.id !== placeId) return place;
    found = true;
    return {
      ...place,
      location: { ...location, source: "user" as const },
      unresolved: undefined,
    };
  });
  if (!found) {
    throw new Error(`place ${placeId} not found in analysis ${analysisId}`);
  }
  const next: Analysis = {
    ...analysis,
    situation: { ...analysis.situation, places },
    meta: {
      ...analysis.meta,
      warnings: [
        ...analysis.meta.warnings,
        {
          code: "USER_CORRECTION",
          message: `用户修正了 ${placeId} 的定位`,
          severity: "info",
          refs: [placeId],
        },
      ],
    },
  };
  await saveAnalysis(next);
  const db = getDatabase();
  db.prepare(
    "DELETE FROM analysis_cache WHERE book_id = ? AND chapter_id = ?",
  ).run(next.bookId, next.chapterId);
  return next;
}
