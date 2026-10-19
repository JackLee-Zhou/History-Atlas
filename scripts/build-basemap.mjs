#!/usr/bin/env node
/**
 * Build the offline basemap used by the atlas.
 *
 * Downloads four Natural Earth 50m GeoJSON layers, clips them to the
 * East/South/Central Asia window used by the app, drops every property that the
 * renderer does not need, rounds coordinates to 4 decimal places and writes
 * minified GeoJSON plus a metadata file to public/basemap/.
 *
 * Run with:
 *   node scripts/build-basemap.mjs
 *   npm run data:basemap
 *
 * The generated files are build artifacts. Do not edit them by hand.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bboxClip } from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "basemap");

/** Bbox used by MapLibre, see BASEMAP_BOUNDS in lib/constants.ts. */
const BBOX = [70, 15, 140, 55];
const COORDINATE_PRECISION = 4;
const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 180_000;

const NATURAL_EARTH_BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

const LAYERS = [
  {
    key: "countries",
    file: "countries.geojson",
    label: "admin 0 countries",
    url: `${NATURAL_EARTH_BASE}/ne_50m_admin_0_countries.geojson`,
    featureType: "polygon",
    minFeatures: 10,
  },
  {
    key: "provinces",
    file: "provinces.geojson",
    label: "admin 1 states/provinces (China only)",
    url: `${NATURAL_EARTH_BASE}/ne_50m_admin_1_states_provinces.geojson`,
    featureType: "polygon",
    minFeatures: 20,
    filter: (properties) =>
      pickProperty(properties, "adm0_a3", "ADM0_A3") === "CHN",
  },
  {
    key: "rivers",
    file: "rivers.geojson",
    label: "rivers and lake centerlines",
    url: `${NATURAL_EARTH_BASE}/ne_50m_rivers_lake_centerlines.geojson`,
    featureType: "line",
    minFeatures: 20,
  },
  {
    key: "lakes",
    file: "lakes.geojson",
    label: "lakes",
    url: `${NATURAL_EARTH_BASE}/ne_50m_lakes.geojson`,
    featureType: "polygon",
    minFeatures: 10,
  },
];

const NATURAL_EARTH_LICENSE =
  "Public domain (Natural Earth, https://www.naturalearthdata.com/about/terms-of-use/)";

function log(message) {
  console.log(`[build-basemap] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read a property field case-insensitively and skip empty values.
 * Natural Earth mixes name_zh / NAME_ZH depending on the layer.
 */
function pickProperty(properties, ...keys) {
  if (!properties) return undefined;
  for (const key of keys) {
    const value = properties[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      continue;
    }
    return value;
  }
  return undefined;
}

function requireString(properties, fieldName, featureDescriptor, keys) {
  const value = pickProperty(properties, ...keys);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `${featureDescriptor}: missing required property ${fieldName} (tried ${keys.join(", ")})`,
    );
  }
  return value;
}

function mapProperties(layerKey, properties, featureDescriptor) {
  switch (layerKey) {
    case "countries": {
      const name = requireString(properties, "name", featureDescriptor, [
        "name",
        "NAME",
        "NAME_LONG",
      ]);
      const nameZh = pickProperty(properties, "name_zh", "NAME_ZH");
      const adm0A3 = requireString(properties, "adm0_a3", featureDescriptor, [
        "adm0_a3",
        "ADM0_A3",
      ]);
      return compactProperties({ name, name_zh: nameZh, adm0_a3: adm0A3 });
    }
    case "provinces": {
      const name = requireString(properties, "name", featureDescriptor, [
        "name",
        "NAME",
        "gn_name",
      ]);
      const nameZh = pickProperty(properties, "name_zh", "NAME_ZH");
      const adm0A3 = requireString(properties, "adm0_a3", featureDescriptor, [
        "adm0_a3",
        "ADM0_A3",
      ]);
      const iso31662 = pickProperty(
        properties,
        "iso_3166_2",
        "ISO_3166_2",
      );
      return compactProperties({
        name,
        name_zh: nameZh,
        adm0_a3: adm0A3,
        iso_3166_2: iso31662,
      });
    }
    case "rivers":
    case "lakes": {
      // The 50m rivers layer carries no Chinese names at all; the lakes layer
      // has a few unnamed features. Omit empty fields instead of inventing data.
      const name = pickProperty(
        properties,
        "name",
        "NAME",
        "name_en",
        "NAME_EN",
        "label",
        "LABEL",
      );
      const nameZh = pickProperty(
        properties,
        "name_zh",
        "NAME_ZH",
        "name_zht",
        "NAME_ZHT",
      );
      return compactProperties({
        name,
        name_zh: nameZh,
        scalerank: pickProperty(properties, "scalerank", "SCALERANK"),
      });
    }
    default:
      throw new Error(`unknown layer: ${layerKey}`);
  }
}

function compactProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function roundCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || !isFiniteNumber(coordinate[0]) || !isFiniteNumber(coordinate[1])) {
    return null;
  }
  const factor = 10 ** COORDINATE_PRECISION;
  return [
    Math.round(coordinate[0] * factor) / factor,
    Math.round(coordinate[1] * factor) / factor,
  ];
}

function roundCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return [];
  if (typeof coordinates[0] === "number") {
    const coordinate = roundCoordinate(coordinates);
    return coordinate ? coordinate : [];
  }
  return coordinates
    .map((child) => roundCoordinates(child))
    .filter((child) => child.length > 0);
}

function samePosition(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function normalizeLine(coordinates) {
  const rounded = roundCoordinates(coordinates);
  if (!Array.isArray(rounded) || rounded.length < 2) return null;
  const deduped = [];
  for (const position of rounded) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !samePosition(previous, position)) deduped.push(position);
  }
  return deduped.length >= 2 ? deduped : null;
}

function normalizeRing(coordinates) {
  const line = normalizeLine(coordinates);
  if (!line) return null;
  if (!samePosition(line[0], line[line.length - 1])) line.push(line[0]);
  const distinct = new Set(line.map((position) => position.join(",")));
  return distinct.size >= 4 ? line : null;
}

/**
 * bboxClip can leave empty polygons/lines behind (e.g. MultiPolygon members
 * completely outside the bbox). Drop those and degenerate rings.
 */
function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry.type !== "string") return null;
  switch (geometry.type) {
    case "LineString": {
      const line = normalizeLine(geometry.coordinates);
      return line ? { type: "LineString", coordinates: line } : null;
    }
    case "MultiLineString": {
      const lines = (geometry.coordinates ?? [])
        .map((line) => normalizeLine(line))
        .filter(Boolean);
      return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
    }
    case "Polygon": {
      const rings = (geometry.coordinates ?? [])
        .map((ring) => normalizeRing(ring))
        .filter(Boolean);
      return rings.length ? { type: "Polygon", coordinates: rings } : null;
    }
    case "MultiPolygon": {
      const polygons = (geometry.coordinates ?? [])
        .map((polygon) =>
          (polygon ?? []).map((ring) => normalizeRing(ring)).filter(Boolean),
        )
        .filter((rings) => rings.length > 0);
      return polygons.length
        ? { type: "MultiPolygon", coordinates: polygons }
        : null;
    }
    default:
      return null;
  }
}

function assertLayerGeometry(layerKey, type, featureDescriptor) {
  if (layerKey === "rivers") {
    if (type !== "LineString" && type !== "MultiLineString") {
      throw new Error(
        `${featureDescriptor}: expected a line geometry, got ${type}`,
      );
    }
    return;
  }
  if (type !== "Polygon" && type !== "MultiPolygon") {
    throw new Error(
      `${featureDescriptor}: expected a polygon geometry, got ${type}`,
    );
  }
}

async function fetchText(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      log(`downloading ${label} (attempt ${attempt}/${FETCH_ATTEMPTS})`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": "history-atlas-build-basemap/1.0" },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status} ${response.statusText}${
            body ? ` — ${body.slice(0, 200)}` : ""
          }`,
        );
      }
      const text = await response.text();
      if (!text.trim()) throw new Error("empty response body");
      return text;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        const delay = attempt * 1_500;
        log(`download failed: ${errorMessage(error)}; retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  throw new Error(
    `failed to download ${label} after ${FETCH_ATTEMPTS} attempts: ${errorMessage(lastError)}`,
  );
}

function parseFeatureCollection(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: response is not valid JSON (${errorMessage(error)})`);
  }
  if (!parsed || parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error(`${label}: expected a GeoJSON FeatureCollection`);
  }
  if (parsed.features.length === 0) {
    throw new Error(`${label}: FeatureCollection has no features`);
  }
  return parsed;
}

function buildLayer(layer, source) {
  const featureCollection = parseFeatureCollection(source, layer.label);
  const features = [];

  for (const [index, feature] of featureCollection.features.entries()) {
    const descriptor = `${layer.label} feature #${index + 1}`;
    if (!feature || !feature.geometry) continue;
    if (layer.filter && !layer.filter(feature.properties)) continue;

    let clipped;
    try {
      clipped = bboxClip(feature, BBOX);
    } catch (error) {
      throw new Error(`${descriptor}: bbox clipping failed: ${errorMessage(error)}`);
    }

    assertLayerGeometry(layer.key, clipped.geometry?.type, descriptor);
    const geometry = normalizeGeometry(clipped.geometry);
    if (!geometry) continue;

    features.push({
      type: "Feature",
      properties: mapProperties(layer.key, feature.properties, descriptor),
      geometry,
    });
  }

  if (features.length < layer.minFeatures) {
    throw new Error(
      `${layer.label}: only ${features.length} features intersect bbox ${JSON.stringify(
        BBOX,
      )}; expected at least ${layer.minFeatures}. Refusing to write a partial basemap.`,
    );
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

async function writeAtomically(files) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const pending = [];
  try {
    for (const file of files) {
      const target = path.join(OUT_DIR, file.name);
      const temporary = `${target}${suffix}`;
      await fs.writeFile(temporary, file.content, "utf8");
      pending.push({ temporary, target });
    }
    for (const { temporary, target } of pending) {
      await fs.rename(temporary, target);
    }
  } catch (error) {
    await Promise.all(
      pending.map(({ temporary }) =>
        fs.rm(temporary, { force: true }).catch(() => {}),
      ),
    );
    throw error;
  }
}

async function main() {
  log(`project root: ${ROOT}`);
  log(`clip bbox: ${JSON.stringify(BBOX)}, precision: ${COORDINATE_PRECISION} decimals`);

  const outputs = [];
  const metadataFiles = {};

  for (const layer of LAYERS) {
    const source = await fetchText(layer.url, layer.label);
    log(`${layer.label}: downloaded ${(Buffer.byteLength(source) / 1024).toFixed(0)} KiB`);
    const featureCollection = buildLayer(layer, source);
    const content = JSON.stringify(featureCollection);
    const bytes = Buffer.byteLength(content);
    outputs.push({ name: layer.file, content });
    metadataFiles[layer.key] = {
      path: `public/basemap/${layer.file}`,
      featureCount: featureCollection.features.length,
      bytes,
      source: layer.url,
    };
    log(
      `${layer.label}: kept ${featureCollection.features.length} features (${(bytes / 1024).toFixed(0)} KiB)`,
    );
  }

  const totalBytes = outputs.reduce(
    (sum, output) => sum + Buffer.byteLength(output.content),
    0,
  );
  const metadata = {
    generatedAt: new Date().toISOString(),
    generator: "scripts/build-basemap.mjs",
    bbox: BBOX,
    crs: "WGS84 (EPSG:4326)",
    coordinatePrecision: COORDINATE_PRECISION,
    format: "minified GeoJSON",
    license: NATURAL_EARTH_LICENSE,
    attribution:
      "Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.",
    sourceRepository:
      "https://github.com/nvkelso/natural-earth-vector (geojson/ directory, master branch)",
    sources: LAYERS.map((layer) => ({
      layer: layer.key,
      url: layer.url,
      license: "Public domain (Natural Earth)",
    })),
    processing: {
      clipping: `turf bboxClip clipped to [${BBOX.join(", ")}]`,
      provinces:
        "only Natural Earth admin-1 features with adm0_a3 === CHN are kept",
      properties: {
        countries: ["name", "name_zh", "adm0_a3"],
        provinces: ["name", "name_zh", "adm0_a3", "iso_3166_2"],
        rivers: ["name", "name_zh", "scalerank"],
        lakes: ["name", "name_zh", "scalerank"],
      },
      notes: [
        "Natural Earth 50m rivers_lake_centerlines has no name_zh field; those features carry name and scalerank only.",
        "A few unnamed Natural Earth lakes/rivers keep geometry with no name property.",
      ],
    },
    files: metadataFiles,
    totalBytes,
  };

  const metadataContent = `${JSON.stringify(metadata, null, 2)}\n`;
  await writeAtomically([
    ...outputs,
    { name: "metadata.json", content: metadataContent },
  ]);

  log(
    `wrote ${outputs.length} layers + metadata.json to public/basemap (${(totalBytes / 1024).toFixed(0)} KiB)`,
  );
}

main().catch((error) => {
  console.error(`[build-basemap] failed: ${errorMessage(error)}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
});
