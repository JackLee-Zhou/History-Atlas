/**
 * Remove any location-bearing fields from model output before it is allowed
 * anywhere near the Analysis. Coordinates can only be written by the server's
 * gazetteer resolver.
 */

const FORBIDDEN_KEYS = new Set([
  "lat",
  "lng",
  "latitude",
  "longitude",
  "location",
  "coordinates",
  "coordinate",
  "geometry",
  "geo",
  "bbox",
  "center",
  "radiusKm",
]);

export interface SanitizedModelValue {
  value: unknown;
  /** True when at least one coordinate-bearing field was removed. */
  stripped: boolean;
  /** Names of the removed fields (bounded, no values). */
  removedKeys: string[];
}

function sanitize(value: unknown, removed: Set<string>, depth: number): unknown {
  if (depth > 8) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, removed, depth + 1));
  }
  if (typeof value !== "object" || value === null) return value;

  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (FORBIDDEN_KEYS.has(key)) {
      removed.add(key);
      continue;
    }
    next[key] = sanitize(entry, removed, depth + 1);
  }
  return next;
}

/** Recursively strip coordinate-bearing fields from a parsed model payload. */
export function stripModelCoordinates(payload: unknown): SanitizedModelValue {
  const removedKeys = new Set<string>();
  const value = sanitize(payload, removedKeys, 0);
  return {
    value,
    stripped: removedKeys.size > 0,
    removedKeys: [...removedKeys].slice(0, 12),
  };
}

export function hasCoordinateFields(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.some(hasCoordinateFields);
  if (typeof payload !== "object" || payload === null) return false;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasCoordinateFields(value)) return true;
  }
  return false;
}
