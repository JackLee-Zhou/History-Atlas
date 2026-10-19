import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ancientPlaceSchema,
  dynastySchema,
  modernPlaceSchema,
} from "@/lib/schema";
import type {
  GazetteerData,
  GazetteerLoadOptions,
} from "./types";

export const GAZETTEER_FILES = {
  ancient: "ancient-places.json",
  modern: "modern-places.json",
  dynasties: "dynasties.json",
} as const;

const caches = new Map<string, Promise<GazetteerData>>();

export function gazetteerDirectory(directory?: string): string {
  return (
    directory?.trim() ||
    path.join(process.cwd(), "assets", "gazetteer")
  );
}

function readCandidateArray(
  raw: unknown,
  keys: string[],
): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    for (const key of keys) {
      const value = (raw as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

async function readEntries<T>(
  directory: string,
  fileName: string,
  kind: string,
  keys: string[],
  schema: z.ZodType<T>,
): Promise<T[]> {
  const filePath = path.join(directory, fileName);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.warn(
        `[gazetteer] 未找到 ${path.join("assets", "gazetteer", fileName)}，使用空列表（分析可继续）。`,
      );
    } else {
      console.warn(
        `[gazetteer] 无法读取 ${fileName}，使用空列表：${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    console.warn(`[gazetteer] ${fileName} 不是合法 JSON，使用空列表。`);
    return [];
  }

  const entries = readCandidateArray(parsed, keys);
  const valid: T[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const result = schema.safeParse(entry);
    if (result.success) {
      valid.push(result.data);
    } else {
      skipped += 1;
    }
  }
  if (skipped > 0) {
    console.warn(
      `[gazetteer] ${fileName} 中有 ${skipped} 条 ${kind} 记录不符合契约，已跳过。`,
    );
  }
  return valid;
}

async function loadDirectory(directory: string): Promise<GazetteerData> {
  const [ancient, modern, dynasties] = await Promise.all([
    readEntries(directory, GAZETTEER_FILES.ancient, "古地名", ["places", "ancient", "ancientPlaces"], ancientPlaceSchema),
    readEntries(directory, GAZETTEER_FILES.modern, "现代地名", ["places", "modern", "modernPlaces"], modernPlaceSchema),
    readEntries(directory, GAZETTEER_FILES.dynasties, "朝代", ["dynasties", "items"], dynastySchema),
  ]);
  return { ancient, modern, dynasties };
}

/**
 * Load the seed gazetteer at runtime. Missing or malformed files degrade to
 * empty lists with a console warning instead of crashing the app: the Data
 * agent may not have generated every asset yet.
 */
export async function loadGazetteer(
  options: GazetteerLoadOptions = {},
): Promise<GazetteerData> {
  const directory = gazetteerDirectory(options.directory);
  if (options.force) caches.delete(directory);
  let cached = caches.get(directory);
  if (!cached) {
    cached = loadDirectory(directory);
    caches.set(directory, cached);
  }
  return cached;
}

export function clearGazetteerCache(): void {
  caches.clear();
}
