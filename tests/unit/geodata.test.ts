import fs from "node:fs";
import path from "node:path";
import type { FeatureCollection, Geometry } from "geojson";
import { describe, expect, it } from "vitest";
import { modernPlaceSchema } from "@/lib/schema/gazetteer";
import type { ModernPlace } from "@/lib/schema/gazetteer";

const ROOT = process.cwd();
const BBOX = [70, 15, 140, 55] as const;
const COORDINATE_EPSILON = 0.01;
const MAX_BASEMAP_BYTES = 8 * 1024 * 1024;
const MAX_GAZETTEER_BYTES = 4 * 1024 * 1024;

const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const ASCII_CHAR = /[A-Za-z]/;

interface LayerSpec {
  key: string;
  file: string;
  minFeatures: number;
  geometryTypes: readonly Geometry["type"][];
  allowedProperties: readonly string[];
}

const LAYERS: readonly LayerSpec[] = [
  {
    key: "countries",
    file: "countries.geojson",
    minFeatures: 20,
    geometryTypes: ["Polygon", "MultiPolygon"],
    allowedProperties: ["name", "name_zh", "adm0_a3"],
  },
  {
    key: "provinces",
    file: "provinces.geojson",
    minFeatures: 25,
    geometryTypes: ["Polygon", "MultiPolygon"],
    allowedProperties: ["name", "name_zh", "adm0_a3", "iso_3166_2"],
  },
  {
    key: "rivers",
    file: "rivers.geojson",
    minFeatures: 60,
    geometryTypes: ["LineString", "MultiLineString"],
    allowedProperties: ["name", "name_zh", "scalerank"],
  },
  {
    key: "lakes",
    file: "lakes.geojson",
    minFeatures: 40,
    geometryTypes: ["Polygon", "MultiPolygon"],
    allowedProperties: ["name", "name_zh", "scalerank"],
  },
];

const GAZETTEER_PATH = "assets/gazetteer/modern-places.json";

function absolutePath(relativePath: string): string {
  return path.resolve(ROOT, relativePath);
}

function readText(relativePath: string): string {
  const filePath = absolutePath(relativePath);
  expect(fs.existsSync(filePath), `${relativePath} 应存在`).toBe(true);
  return fs.readFileSync(filePath, "utf8");
}

function parseJsonFile(relativePath: string): unknown {
  const text = readText(relativePath);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${relativePath} 不是合法 JSON: ${String(error)}`);
  }
}

function loadFeatureCollection(
  relativePath: string,
): FeatureCollection<Geometry, Record<string, unknown>> {
  const parsed = parseJsonFile(relativePath);
  expect(parsed !== null && typeof parsed === "object", `${relativePath} 应为对象`).toBe(
    true,
  );
  const candidate = parsed as { type?: unknown; features?: unknown };
  expect(candidate.type, `${relativePath}.type`).toBe("FeatureCollection");
  expect(Array.isArray(candidate.features), `${relativePath}.features`).toBe(true);
  return candidate as unknown as FeatureCollection<
    Geometry,
    Record<string, unknown>
  >;
}

function collectPositions(coordinates: unknown): number[][] {
  if (!Array.isArray(coordinates)) return [];
  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    return [coordinates as number[]];
  }
  return coordinates.flatMap((child) => collectPositions(child));
}

function geometryPositions(geometry: Geometry): number[][] {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.flatMap((child) => geometryPositions(child));
  }
  return collectPositions(geometry.coordinates);
}

function assertWithinBBox(relativePath: string, positions: number[][]): void {
  const outOfBounds: string[] = [];
  const imprecise: string[] = [];
  for (const [lng, lat] of positions) {
    if (
      typeof lng !== "number" ||
      typeof lat !== "number" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) {
      outOfBounds.push(`non-finite ${String(lng)},${String(lat)}`);
      continue;
    }
    if (
      lng < BBOX[0] - COORDINATE_EPSILON ||
      lng > BBOX[2] + COORDINATE_EPSILON ||
      lat < BBOX[1] - COORDINATE_EPSILON ||
      lat > BBOX[3] + COORDINATE_EPSILON
    ) {
      outOfBounds.push(`${lng},${lat}`);
      continue;
    }
    const roundedLng = Math.round(lng * 10_000) / 10_000;
    const roundedLat = Math.round(lat * 10_000) / 10_000;
    if (Math.abs(lng - roundedLng) > 1e-9 || Math.abs(lat - roundedLat) > 1e-9) {
      imprecise.push(`${lng},${lat}`);
    }
  }
  expect(outOfBounds.slice(0, 5), `${relativePath} 有坐标越界`).toEqual([]);
  expect(imprecise.slice(0, 5), `${relativePath} 坐标应保留至多 4 位小数`).toEqual(
    [],
  );
}

let cachedPlaces: ModernPlace[] | undefined;

function loadPlaces(): ModernPlace[] {
  if (cachedPlaces) return cachedPlaces;
  const parsed = parseJsonFile(GAZETTEER_PATH);
  const result = modernPlaceSchema.array().safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
    throw new Error(
      `${GAZETTEER_PATH} 不符合 ModernPlace schema:\n${issues.join("\n")}`,
    );
  }
  cachedPlaces = result.data;
  return cachedPlaces;
}

describe("离线底图", () => {
  it("四个图层和 metadata 存在，总体积在预算内", () => {
    let totalBytes = 0;
    for (const layer of LAYERS) {
      const filePath = absolutePath(`public/basemap/${layer.file}`);
      expect(fs.existsSync(filePath), `${layer.file} 应存在`).toBe(true);
      totalBytes += fs.statSync(filePath).size;
    }
    expect(fs.existsSync(absolutePath("public/basemap/metadata.json"))).toBe(true);
    expect(totalBytes).toBeGreaterThan(0);
    expect(totalBytes).toBeLessThan(MAX_BASEMAP_BYTES);
  });

  it("metadata.json 记录来源、bbox、生成时间和文件计数", () => {
    const metadata = parseJsonFile("public/basemap/metadata.json") as {
      generatedAt?: unknown;
      bbox?: unknown;
      license?: unknown;
      sources?: unknown;
      files?: Record<string, { featureCount?: unknown; bytes?: unknown }>;
    };
    expect(metadata.bbox).toEqual([...BBOX]);
    expect(typeof metadata.generatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(metadata.generatedAt as string))).toBe(false);
    expect(String(metadata.license)).toContain("Public domain");
    expect(Array.isArray(metadata.sources)).toBe(true);
    const sources = metadata.sources as Array<{ url?: unknown }>;
    expect(sources.length).toBeGreaterThanOrEqual(4);
    for (const source of sources) {
      expect(typeof source.url).toBe("string");
      expect(String(source.url)).toMatch(
        /^https:\/\/raw\.githubusercontent\.com\/nvkelso\/natural-earth-vector\/master\/geojson\/ne_50m_/,
      );
    }

    expect(metadata.files).toBeTruthy();
    for (const layer of LAYERS) {
      const entry = metadata.files?.[layer.key];
      expect(entry, `metadata.files.${layer.key}`).toBeTruthy();
      const collection = loadFeatureCollection(`public/basemap/${layer.file}`);
      expect(entry?.featureCount).toBe(collection.features.length);
      expect(entry?.bytes).toBe(
        fs.statSync(absolutePath(`public/basemap/${layer.file}`)).size,
      );
    }
  });

  for (const layer of LAYERS) {
    it(`${layer.file} 是裁剪后的合法 GeoJSON 且坐标在范围内`, () => {
      const collection = loadFeatureCollection(`public/basemap/${layer.file}`);
      expect(collection.features.length).toBeGreaterThanOrEqual(
        layer.minFeatures,
      );

      const badGeometryTypes: string[] = [];
      const positions: number[][] = [];
      for (const feature of collection.features) {
        expect(feature.type).toBe("Feature");
        if (!layer.geometryTypes.includes(feature.geometry.type)) {
          badGeometryTypes.push(feature.geometry.type);
          continue;
        }
        positions.push(...geometryPositions(feature.geometry));
      }

      expect(badGeometryTypes.slice(0, 5), `${layer.file} 几何类型`).toEqual([]);
      expect(positions.length).toBeGreaterThan(0);
      assertWithinBBox(`public/basemap/${layer.file}`, positions);
    });

    it(`${layer.file} 只保留约定的属性`, () => {
      const collection = loadFeatureCollection(`public/basemap/${layer.file}`);
      const allowed = new Set(layer.allowedProperties);
      const unexpected = new Set<string>();
      for (const feature of collection.features) {
        for (const key of Object.keys(feature.properties ?? {})) {
          if (!allowed.has(key)) unexpected.add(key);
        }
      }
      expect([...unexpected], `${layer.file} 含未约定属性`).toEqual([]);
    });
  }

  it("countries 保留中文名、英文名和 adm0_a3", () => {
    const collection = loadFeatureCollection("public/basemap/countries.geojson");
    let withChineseName = 0;
    for (const feature of collection.features) {
      const properties = feature.properties ?? {};
      expect(typeof properties.name).toBe("string");
      expect(String(properties.name).length).toBeGreaterThan(0);
      expect(String(properties.adm0_a3)).toMatch(/^[A-Z0-9]{3}$/);
      if (
        typeof properties.name_zh === "string" &&
        CJK_CHAR.test(properties.name_zh)
      ) {
        withChineseName += 1;
      }
    }
    expect(withChineseName).toBeGreaterThanOrEqual(
      Math.ceil(collection.features.length * 0.8),
    );
  });

  it("provinces 只包含中国省级要素并保留 ISO 3166-2 代码", () => {
    const collection = loadFeatureCollection("public/basemap/provinces.geojson");
    let withChineseName = 0;
    for (const feature of collection.features) {
      const properties = feature.properties ?? {};
      expect(properties.adm0_a3).toBe("CHN");
      expect(String(properties.iso_3166_2)).toMatch(/^CN-[A-Z0-9]+$/);
      if (
        typeof properties.name_zh === "string" &&
        CJK_CHAR.test(properties.name_zh)
      ) {
        withChineseName += 1;
      }
    }
    expect(withChineseName).toBeGreaterThanOrEqual(
      Math.ceil(collection.features.length * 0.8),
    );
  });

  it("rivers/lakes 保留 scalerank，且有名称的要素名称非空", () => {
    for (const key of ["rivers", "lakes"] as const) {
      const collection = loadFeatureCollection(`public/basemap/${key}.geojson`);
      let named = 0;
      for (const feature of collection.features) {
        const properties = feature.properties ?? {};
        expect(typeof properties.scalerank).toBe("number");
        expect(Number.isFinite(properties.scalerank as number)).toBe(true);
        if (properties.name !== undefined) {
          expect(typeof properties.name).toBe("string");
          expect(String(properties.name).length).toBeGreaterThan(0);
          named += 1;
        }
        if (properties.name_zh !== undefined) {
          expect(typeof properties.name_zh).toBe("string");
        }
      }
      expect(
        named,
        `${key}.geojson 应有多数命名要素`,
      ).toBeGreaterThanOrEqual(Math.ceil(collection.features.length * 0.7));
    }
  });
});

describe("现代地名库", () => {
  it("是合法 JSON 数组，体积合理且不少于 1200 条", () => {
    const filePath = absolutePath(GAZETTEER_PATH);
    expect(fs.existsSync(filePath), `${GAZETTEER_PATH} 应存在`).toBe(true);
    const stats = fs.statSync(filePath);
    expect(stats.size).toBeGreaterThan(100 * 1024);
    expect(stats.size).toBeLessThan(MAX_GAZETTEER_BYTES);
    const parsed = parseJsonFile(GAZETTEER_PATH);
    expect(Array.isArray(parsed)).toBe(true);
    const places = loadPlaces();
    expect(places.length).toBeGreaterThanOrEqual(1200);
    expect(places.length).toBeLessThan(50_000);
  });

  it("ID 唯一且与 geonameId 一致", () => {
    const places = loadPlaces();
    const ids = new Set<string>();
    const duplicates: string[] = [];
    const mismatched: string[] = [];
    for (const place of places) {
      if (ids.has(place.id)) duplicates.push(place.id);
      ids.add(place.id);
      if (place.geonameId === undefined || place.id !== `gn-${place.geonameId}`) {
        mismatched.push(place.id);
      }
      expect(place.id).toMatch(/^gn-\d+$/);
    }
    expect(duplicates.slice(0, 5)).toEqual([]);
    expect(mismatched.slice(0, 5)).toEqual([]);
    expect(ids.size).toBe(places.length);
  });

  it("坐标落在中国周边 bbox 内", () => {
    const places = loadPlaces();
    const outOfBounds: string[] = [];
    for (const place of places) {
      const { lat, lng } = place;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        outOfBounds.push(`${place.id}: non-finite`);
        continue;
      }
      if (
        lat < BBOX[1] ||
        lat > BBOX[3] ||
        lng < BBOX[0] ||
        lng > BBOX[2]
      ) {
        outOfBounds.push(`${place.id}: ${lat},${lng}`);
      }
    }
    expect(outOfBounds.slice(0, 5), "地名坐标越界").toEqual([]);
  });

  it("别名去重、长度受控，中文名和 asciiname 可检索", () => {
    const places = loadPlaces();
    const problems: string[] = [];
    let withChineseName = 0;
    let withChineseAlias = 0;
    let withAsciiAlias = 0;
    let withAdmin1 = 0;
    for (const place of places) {
      if (place.aliases.length === 0 || place.aliases.length > 8) {
        problems.push(`${place.id}: alias count ${place.aliases.length}`);
      }
      if (new Set(place.aliases).size !== place.aliases.length) {
        problems.push(`${place.id}: duplicate aliases`);
      }
      if (place.aliases.some((alias) => alias.length > 40)) {
        problems.push(`${place.id}: overlong alias`);
      }
      if (CJK_CHAR.test(place.name)) withChineseName += 1;
      if (place.aliases.some((alias) => CJK_CHAR.test(alias))) {
        withChineseAlias += 1;
      }
      if (place.aliases.some((alias) => ASCII_CHAR.test(alias))) {
        withAsciiAlias += 1;
      }
      if (place.admin1) withAdmin1 += 1;
    }
    expect(problems.slice(0, 5), "别名约束").toEqual([]);
    expect(withChineseName).toBeGreaterThanOrEqual(
      Math.ceil(places.length * 0.9),
    );
    expect(withChineseAlias).toBeGreaterThanOrEqual(withChineseName);
    expect(withAsciiAlias).toBe(places.length);
    expect(withAdmin1).toBeGreaterThanOrEqual(
      Math.ceil(places.length * 0.95),
    );
  });

  it("主要城市中文名优先，且坐标接近实际位置", () => {
    const places = loadPlaces();
    const beijing = places.find((place) => place.name === "北京");
    const shanghai = places.find((place) => place.name === "上海");
    if (!beijing || !shanghai) {
      throw new Error("现代地名库应包含北京和上海");
    }
    expect(beijing.aliases).toContain("Beijing");
    expect(shanghai.aliases).toContain("Shanghai");
    expect(beijing.lat).toBeCloseTo(39.9, 0);
    expect(beijing.lng).toBeCloseTo(116.4, 0);
    expect(shanghai.lat).toBeCloseTo(31.2, 0);
    expect(shanghai.lng).toBeCloseTo(121.5, 0);
  });

  it("人口字段只出现在人口 > 0 的记录上", () => {
    const places = loadPlaces();
    const populated = places.filter((place) => place.population !== undefined);
    expect(populated.length).toBeGreaterThanOrEqual(1200);
    for (const place of populated) {
      const population = place.population;
      if (population === undefined) continue;
      expect(population).toBeGreaterThan(0);
      expect(Number.isInteger(population)).toBe(true);
    }
    const maxPopulation = Math.max(
      ...populated.map((place) => place.population ?? 0),
    );
    expect(maxPopulation).toBeGreaterThanOrEqual(10_000_000);
  });
});
