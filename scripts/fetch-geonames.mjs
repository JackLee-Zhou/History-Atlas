#!/usr/bin/env node
/**
 * Build assets/gazetteer/modern-places.json from the GeoNames China dump.
 *
 * Sources:
 *   https://download.geonames.org/export/dump/CN.zip
 *   https://download.geonames.org/export/dump/admin1CodesASCII.txt
 *
 * Selection:
 *   - feature class P only (populated places)
 *   - PPLA / PPLA2 / PPLA3 / PPLA4 / PPLC / PPLG / PPLS / PPL
 *   - the 1200 most populous places with population > 0
 *   - plus every PPLA* seat of government (PPLA, PPLA2, PPLA3, PPLA4)
 *
 * Run with:
 *   node scripts/fetch-geonames.mjs
 *   npm run data:geonames
 *
 * GeoNames data is licensed CC BY 4.0. See assets/gazetteer/README.md.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "gazetteer");
const OUT_FILE = path.join(OUT_DIR, "modern-places.json");

const CN_ZIP_URL = "https://download.geonames.org/export/dump/CN.zip";
const ADMIN1_URL =
  "https://download.geonames.org/export/dump/admin1CodesASCII.txt";

/** Same window as the offline basemap, see BASEMAP_BOUNDS in lib/constants.ts. */
const BBOX = [70, 15, 140, 55];
const TOP_POPULATION_COUNT = 1200;
const ALIAS_LIMIT = 8;
const MAX_ALIAS_LENGTH = 40;
const FETCH_ATTEMPTS = 3;
const ZIP_FETCH_TIMEOUT_MS = 300_000;
const TEXT_FETCH_TIMEOUT_MS = 120_000;

const ALLOWED_FEATURE_CODES = new Set([
  "PPLA",
  "PPLA2",
  "PPLA3",
  "PPLA4",
  "PPLC",
  "PPLG",
  "PPLS",
  "PPL",
]);

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const CJK_NAME_ONLY = /^[\u3400-\u4dbf\u4e00-\u9fff\u3000·\s\-—–（）()]+$/u;

function log(message) {
  console.log(`[fetch-geonames] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithRetry(url, label, { timeoutMs, binary }) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      log(`downloading ${label} (attempt ${attempt}/${FETCH_ATTEMPTS})`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "history-atlas-fetch-geonames/1.0" },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status} ${response.statusText}${
            body ? ` — ${body.slice(0, 200)}` : ""
          }`,
        );
      }
      const content = binary
        ? Buffer.from(await response.arrayBuffer())
        : await response.text();
      if (binary ? content.length === 0 : !content.trim()) {
        throw new Error("empty response body");
      }
      return content;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        const delay = attempt * 2_000;
        log(`download failed: ${errorMessage(error)}; retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw new Error(
    `failed to download ${label} after ${FETCH_ATTEMPTS} attempts: ${errorMessage(lastError)}`,
  );
}

function parseAdmin1Names(text) {
  const names = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const columns = line.split("\t");
    const code = columns[0]?.trim();
    if (!code) continue;
    // Future-proof: if GeoNames ever provides a Chinese column, prefer it.
    const chineseColumn = columns
      .slice(1)
      .map((column) => column.trim())
      .find((column) => column.length > 0 && CJK_CHAR.test(column));
    const fallback = (columns[1] ?? columns[2] ?? "").trim();
    names.set(code, chineseColumn || fallback);
  }
  return names;
}

async function readCnTxt(zipBuffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (error) {
    throw new Error(`CN.zip is not a readable zip archive: ${errorMessage(error)}`);
  }
  const entry = Object.values(zip.files).find(
    (file) => !file.dir && file.name.toUpperCase() === "CN.TXT",
  );
  if (!entry) {
    throw new Error(
      `CN.zip does not contain CN.txt (entries: ${Object.keys(zip.files)
        .slice(0, 10)
        .join(", ")})`,
    );
  }
  return entry.async("string");
}

function collectChineseCandidates(alternateNames) {
  if (!alternateNames) return [];
  const candidates = [];
  for (const raw of alternateNames.split(",")) {
    const candidate = raw.trim();
    if (candidate.length < 2 || candidate.length > MAX_ALIAS_LENGTH) continue;
    if (!CJK_NAME_ONLY.test(candidate)) continue;
    candidates.push(candidate);
  }
  return candidates;
}

/**
 * Pick the most likely common Chinese name. GeoNames alternatenames mixes
 * traditional, simplified, historical and Japanese-kanji spellings. Names that
 * are a prefix of a longer variant are usually the base form (成都 / 成都市),
 * so rank those first, then shorter and earlier entries.
 */
function rankChineseCandidates(candidates) {
  const unique = [...new Set(candidates)];
  return unique
    .map((name, index) => ({
      name,
      index,
      isBaseForm: unique.some(
        (other) => other.length > name.length && other.startsWith(name),
      )
        ? 0
        : 1,
      length: name.length,
    }))
    .sort(
      (a, b) =>
        a.isBaseForm - b.isBaseForm ||
        a.length - b.length ||
        a.index - b.index,
    )
    .map((entry) => entry.name);
}

function pickPreferredName(record) {
  if (CJK_CHAR.test(record.name)) return record.name;
  const ranked = rankChineseCandidates(
    collectChineseCandidates(record.alternateNames),
  );
  return ranked[0] ?? record.name;
}

function buildAliases(record, preferredName) {
  const aliases = [];
  const seen = new Set();
  const add = (value) => {
    if (aliases.length >= ALIAS_LIMIT) return;
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_ALIAS_LENGTH) return;
    if (/[\t\r\n]/.test(trimmed)) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    aliases.push(trimmed);
  };

  add(preferredName);
  add(record.asciiName);
  add(record.name);
  for (const candidate of rankChineseCandidates(
    collectChineseCandidates(record.alternateNames),
  )) {
    add(candidate);
  }
  return aliases;
}

function parseRecord(columns) {
  const geonameId = Number.parseInt(columns[0], 10);
  if (!Number.isInteger(geonameId) || geonameId <= 0) return null;

  const name = (columns[1] ?? "").trim();
  if (!name) return null;

  const lat = Number.parseFloat(columns[4]);
  const lng = Number.parseFloat(columns[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < BBOX[1] || lat > BBOX[3] || lng < BBOX[0] || lng > BBOX[2]) {
    return null;
  }

  const population = Number.parseInt(columns[14], 10);
  return {
    geonameId,
    name,
    asciiName: (columns[2] ?? "").trim(),
    alternateNames: columns[3] ?? "",
    lat,
    lng,
    featureCode: (columns[7] ?? "").trim(),
    admin1Code: (columns[10] ?? "").trim(),
    population: Number.isInteger(population) && population > 0 ? population : 0,
  };
}

function selectRecords(cnText, stats) {
  const populated = [];
  const ppaSeats = [];

  for (const line of cnText.split("\n")) {
    if (!line) continue;
    const columns = line.split("\t");
    if (columns.length < 19) {
      stats.malformedLines += 1;
      continue;
    }
    if (columns[6] !== "P") continue;
    stats.populatedPlaceRecords += 1;

    const featureCode = (columns[7] ?? "").trim();
    if (!ALLOWED_FEATURE_CODES.has(featureCode)) continue;
    stats.allowedFeatureRecords += 1;

    const record = parseRecord(columns);
    if (!record) {
      stats.rejectedRecords += 1;
      continue;
    }
    if (record.population > 0) populated.push(record);
    if (record.featureCode.startsWith("PPLA")) ppaSeats.push(record);
  }

  populated.sort(
    (a, b) => b.population - a.population || a.geonameId - b.geonameId,
  );
  const topPopulated = populated.slice(0, TOP_POPULATION_COUNT);

  const selected = [];
  const seen = new Set();
  for (const record of [...topPopulated, ...ppaSeats]) {
    if (seen.has(record.geonameId)) continue;
    seen.add(record.geonameId);
    selected.push(record);
  }

  stats.populationRecords = populated.length;
  stats.topPopulationRecords = topPopulated.length;
  stats.ppaSeatRecords = ppaSeats.length;
  stats.selectedRecords = selected.length;
  return selected;
}

function toModernPlace(record, admin1Names, stats) {
  const name = pickPreferredName(record);
  const aliases = buildAliases(record, name);
  const admin1 = admin1Names.get(`CN.${record.admin1Code}`);

  if (!admin1) stats.missingAdmin1 += 1;
  if (!CJK_CHAR.test(name)) stats.nonChineseNames += 1;

  const place = {
    id: `gn-${record.geonameId}`,
    name,
    aliases,
    lat: Math.round(record.lat * 1e5) / 1e5,
    lng: Math.round(record.lng * 1e5) / 1e5,
  };
  if (admin1) place.admin1 = admin1;
  if (record.population > 0) place.population = record.population;
  place.geonameId = record.geonameId;
  return place;
}

function validatePlaces(places) {
  if (places.length < TOP_POPULATION_COUNT) {
    throw new Error(
      `only ${places.length} places selected; expected at least ${TOP_POPULATION_COUNT}`,
    );
  }
  const ids = new Set();
  for (const [index, place] of places.entries()) {
    if (!place.name) throw new Error(`place #${index} has an empty name`);
    if (ids.has(place.id)) throw new Error(`duplicate place id: ${place.id}`);
    ids.add(place.id);
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      throw new Error(`place ${place.id} has non-finite coordinates`);
    }
    if (
      place.lat < BBOX[1] ||
      place.lat > BBOX[3] ||
      place.lng < BBOX[0] ||
      place.lng > BBOX[2]
    ) {
      throw new Error(
        `place ${place.id} is outside the expected bbox: ${place.lat},${place.lng}`,
      );
    }
    if (place.aliases.length === 0 || place.aliases.length > ALIAS_LIMIT) {
      throw new Error(
        `place ${place.id} has ${place.aliases.length} aliases; expected 1-${ALIAS_LIMIT}`,
      );
    }
    if (new Set(place.aliases).size !== place.aliases.length) {
      throw new Error(`place ${place.id} has duplicate aliases`);
    }
    for (const alias of place.aliases) {
      if (alias.length > MAX_ALIAS_LENGTH) {
        throw new Error(`place ${place.id} has an overlong alias`);
      }
    }
  }
}

async function writeAtomically(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function main() {
  log(`project root: ${ROOT}`);

  const [zipBuffer, admin1Text] = await Promise.all([
    fetchWithRetry(CN_ZIP_URL, "CN.zip", {
      timeoutMs: ZIP_FETCH_TIMEOUT_MS,
      binary: true,
    }),
    fetchWithRetry(ADMIN1_URL, "admin1CodesASCII.txt", {
      timeoutMs: TEXT_FETCH_TIMEOUT_MS,
      binary: false,
    }),
  ]);
  log(`CN.zip: ${(zipBuffer.length / 1024 / 1024).toFixed(1)} MiB downloaded`);

  const admin1Names = parseAdmin1Names(admin1Text);
  log(`admin1 codes: ${admin1Names.size} entries`);

  const cnText = await readCnTxt(zipBuffer);
  log(`CN.txt: ${(Buffer.byteLength(cnText) / 1024 / 1024).toFixed(1)} MiB decompressed`);

  const stats = {
    malformedLines: 0,
    populatedPlaceRecords: 0,
    allowedFeatureRecords: 0,
    rejectedRecords: 0,
    populationRecords: 0,
    topPopulationRecords: 0,
    ppaSeatRecords: 0,
    selectedRecords: 0,
    nonChineseNames: 0,
    missingAdmin1: 0,
  };

  const selected = selectRecords(cnText, stats);
  const places = selected.map((record) =>
    toModernPlace(record, admin1Names, stats),
  );
  validatePlaces(places);

  const content = `${JSON.stringify(places)}\n`;
  const bytes = Buffer.byteLength(content);
  await writeAtomically(OUT_FILE, content);

  const megabytes = bytes / 1024 / 1024;
  log(
    `parsed ${stats.populatedPlaceRecords} P records, ${stats.allowedFeatureRecords} in the allowed feature codes`,
  );
  log(
    `selected ${stats.selectedRecords} places (top ${stats.topPopulationRecords} by population + ${stats.ppaSeatRecords} PPLA* seats), ${megabytes.toFixed(2)} MiB`,
  );
  log(
    `names without a Chinese form: ${stats.nonChineseNames}; places without admin1: ${stats.missingAdmin1}`,
  );
  log(`wrote ${path.relative(ROOT, OUT_FILE)}`);
}

main().catch((error) => {
  console.error(`[fetch-geonames] failed: ${errorMessage(error)}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
});
