import {
  buffer as turfBuffer,
  lineString as turfLineString,
  point as turfPoint,
  polygon as turfPolygon,
} from "@turf/turf";
import type { PolygonGeometry } from "@/lib/schema";
import { clamp } from "@/lib/utils";

export type LngLat = [number, number];

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizePoint([lng, lat]: LngLat): LngLat {
  return [
    round(clamp(lng, -180, 180)),
    round(clamp(lat, -85, 85)),
  ];
}

function dedupePoints(points: LngLat[]): LngLat[] {
  const seen = new Set<string>();
  const result: LngLat[] = [];
  for (const point of points) {
    const normalized = normalizePoint(point);
    const key = `${normalized[0]},${normalized[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function cross(origin: LngLat, a: LngLat, b: LngLat): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}

/** Monotone-chain convex hull. Returns points in counter-clockwise order. */
export function convexHull(points: LngLat[]): LngLat[] {
  const unique = dedupePoints(points);
  if (unique.length <= 2) return unique;
  const sorted = unique.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower: LngLat[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: LngLat[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function centroid(points: LngLat[]): LngLat {
  const [lngSum, latSum] = points.reduce<[number, number]>(
    ([lngAcc, latAcc], point) => [lngAcc + point[0], latAcc + point[1]],
    [0, 0],
  );
  return [lngSum / points.length, latSum / points.length];
}

function kmToLatDegrees(km: number): number {
  return km / 111;
}

function kmToLngDegrees(km: number, atLat: number): number {
  return km / (111 * Math.max(0.2, Math.cos((atLat * Math.PI) / 180)));
}

function closeRing(points: LngLat[]): LngLat[] {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

/**
 * Soft, intentionally imprecise area around a faction's located places.
 * A buffered hull/line/circle reads as "rough area" instead of a hard triangle;
 * analyses mark every control area as schematic.
 */
export function bufferedControlPolygon(
  points: LngLat[],
  padKm: number,
): PolygonGeometry | null {
  const unique = dedupePoints(points);
  if (unique.length === 0) return null;

  try {
    const source =
      unique.length === 1
        ? turfPoint(unique[0]!)
        : unique.length === 2
          ? turfLineString(unique)
          : turfPolygon([closeRing(convexHull(unique))]);
    const buffered = turfBuffer(source, padKm, {
      units: "kilometers",
      steps: 16,
    });
    const ring = (buffered?.geometry.coordinates as number[][][] | undefined)?.[0];
    if (ring && ring.length >= 3) {
      return {
        type: "Polygon",
        coordinates: [ring.map(([lng, lat]) => normalizePoint([lng, lat]))],
      };
    }
  } catch {
    // Fall through to the deterministic convex expansion below.
  }

  if (unique.length === 1) {
    const [lng, lat] = unique[0]!;
    const latPad = kmToLatDegrees(padKm);
    const lngPad = kmToLngDegrees(padKm, lat);
    return {
      type: "Polygon",
      coordinates: [
        closeRing([
          [lng - lngPad, lat - latPad],
          [lng + lngPad, lat - latPad],
          [lng + lngPad, lat + latPad],
          [lng - lngPad, lat + latPad],
        ]),
      ],
    };
  }

  if (unique.length === 2) {
    const [a, b] = unique as [LngLat, LngLat];
    const midLat = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return bufferedControlPolygon([a], padKm);
    const latPad = kmToLatDegrees(padKm);
    const lngPad = kmToLngDegrees(padKm, midLat);
    const perpX = (-dy / length) * lngPad;
    const perpY = (dx / length) * latPad;
    return {
      type: "Polygon",
      coordinates: [
        closeRing([
          [a[0] + perpX, a[1] + perpY],
          [b[0] + perpX, b[1] + perpY],
          [b[0] - perpX, b[1] - perpY],
          [a[0] - perpX, a[1] - perpY],
        ]),
      ],
    };
  }

  const hull = convexHull(unique);
  const center = centroid(hull);
  const padDegrees =
    (kmToLatDegrees(padKm) + kmToLngDegrees(padKm, center[1])) / 2;
  return {
    type: "Polygon",
    coordinates: [
      closeRing(
        hull.map(([lng, lat]) => {
          const dx = lng - center[0];
          const dy = lat - center[1];
          const distance = Math.hypot(dx, dy);
          if (distance === 0) return [lng, lat] as LngLat;
          const factor = (distance + padDegrees) / distance;
          return normalizePoint([
            center[0] + dx * factor,
            center[1] + dy * factor,
          ]);
        }),
      ),
    ],
  };
}

export interface SceneCamera {
  center: [number, number];
  zoom: number;
}

/** Camera fits the bounding box of the supplied points (lng/lat). */
export function cameraForPoints(points: LngLat[]): SceneCamera | undefined {
  const unique = dedupePoints(points);
  if (unique.length === 0) return undefined;
  const lngs = unique.map((point) => point[0]);
  const lats = unique.map((point) => point[1]);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lngSpan = Math.max(maxLng - minLng, 0.01) *
    Math.max(0.2, Math.cos((centerLat * Math.PI) / 180));
  const span = Math.max(latSpan, lngSpan, 0.02);
  const zoom = clamp(Math.log2(360 / span) - 0.8, 1, 11);
  return {
    center: [round(centerLng, 4), round(centerLat, 4)],
    zoom: Math.round(zoom * 10) / 10,
  };
}

/** Minimum polygon padding for a control area, derived from place precision. */
export function controlAreaPaddingKm(radiusKm: number[]): number {
  const maxRadius = radiusKm.length > 0 ? Math.max(...radiusKm) : 12;
  return clamp(maxRadius + 25, 30, 90);
}
