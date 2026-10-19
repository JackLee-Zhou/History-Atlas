import "server-only";

import fs from "node:fs";
import path from "node:path";

export interface ProvinceInfo {
  code: string;
  name: string;
  aliases: string[];
}

const SUFFIXES = [
  "维吾尔自治区",
  "壮族自治区",
  "回族自治区",
  "特别行政区",
  "自治区",
  "省",
  "市",
] as const;

export function normalizeProvinceName(value: string): string {
  let name = value.replace(/\s+/gu, "").trim();
  for (const suffix of SUFFIXES) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return name;
}

function buildCatalog(): ProvinceInfo[] {
  const file = path.join(process.cwd(), "public", "basemap", "provinces.geojson");
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as {
    features?: Array<{ properties?: Record<string, unknown> }>;
  };
  const catalog: ProvinceInfo[] = [];
  for (const feature of parsed.features ?? []) {
    const props = feature.properties ?? {};
    const nameZh =
      typeof props.name_zh === "string"
        ? props.name_zh.trim()
        : typeof props.name === "string"
          ? props.name.trim()
          : "";
    if (!nameZh) continue;
    const code =
      typeof props.iso_3166_2 === "string" ? props.iso_3166_2 : nameZh;
    const aliases = new Set<string>([
      nameZh,
      normalizeProvinceName(nameZh),
      typeof props.name === "string" ? props.name.trim() : "",
    ]);
    catalog.push({
      code,
      name: nameZh,
      aliases: [...aliases].filter(Boolean),
    });
  }
  return catalog;
}

let cachedCatalog: ProvinceInfo[] | null = null;

export function getProvinceCatalog(): ProvinceInfo[] {
  cachedCatalog ??= buildCatalog();
  return cachedCatalog;
}

export function findProvinceByModelName(
  value: string,
  catalog: ProvinceInfo[],
): ProvinceInfo | undefined {
  const raw = value.replace(/\s+/gu, "").trim();
  const normalized = normalizeProvinceName(raw);
  return catalog.find((province) => {
    if (province.name === raw || province.code === raw) return true;
    return province.aliases.some(
      (alias) =>
        alias === raw || normalizeProvinceName(alias) === normalized,
    );
  });
}
