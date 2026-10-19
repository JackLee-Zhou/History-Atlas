import {
  bearing as turfBearing,
  circle as turfCircle,
  distance as turfDistance,
  midpoint as turfMidpoint,
} from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import type { Place } from "@/lib/schema";
import type { LngLatLike, LngLatTuple } from "./types";

/** Locations at or below this confidence are treated as uncertain on the map. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

function toTuple(position: LngLatLike): LngLatTuple {
  if ("lng" in position) return [position.lng, position.lat];
  return position;
}

function toPosition(position: LngLatLike): [number, number] {
  const [lng, lat] = toTuple(position);
  return [lng, lat];
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: LngLatLike, b: LngLatLike): number {
  return turfDistance(toPosition(a), toPosition(b), { units: "kilometers" });
}

/** Geometric midpoint (degrees) between two coordinates. */
export function midpoint(a: LngLatLike, b: LngLatLike): LngLatTuple {
  const feature = turfMidpoint(toPosition(a), toPosition(b));
  const [lng, lat] = feature.geometry.coordinates;
  return [lng, lat];
}

/** Initial bearing from `a` to `b`, normalised to 0–360 degrees clockwise from north. */
export function bearing(a: LngLatLike, b: LngLatLike): number {
  const value = turfBearing(toPosition(a), toPosition(b));
  return ((value % 360) + 360) % 360;
}

/** A geodesic circle polygon, used for the dashed accuracy rings. */
export function circlePolygon(
  center: LngLatLike,
  radiusKm: number,
  steps = 64,
): Feature<Polygon> {
  const safeRadius = Number.isFinite(radiusKm) ? Math.max(0, radiusKm) : 0;
  const safeSteps = Math.min(256, Math.max(3, Math.round(steps)));
  return turfCircle(toPosition(center), safeRadius, {
    steps: safeSteps,
    units: "kilometers",
    properties: {},
  }) as Feature<Polygon>;
}

/**
 * True when a place is unresolved, or is placed with low confidence.
 * Low precision (county/city) is handled separately by `needsAccuracyRing`.
 */
export function isLowConfidence(place: Place): boolean {
  if (!place.location) return true;
  return place.location.confidence < LOW_CONFIDENCE_THRESHOLD;
}

/** Dashed error circles are useful for low-confidence or coarse-precision places. */
export function needsAccuracyRing(place: Place): boolean {
  if (!place.location) return false;
  if (place.location.radiusKm <= 0) return false;
  return isLowConfidence(place) || place.location.precision !== "site";
}

/** Stable 0/1 hash used to curve each route consistently across renders. */
function hashSign(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return hash % 2 === 0 ? 1 : -1;
}

/**
 * Quadratic-bezier route geometry. The curve is small enough to stay near the
 * actual corridor but avoids the "all straight lines" look of the old atlas.
 */
export function curvedLine(
  start: LngLatLike,
  end: LngLatLike,
  seed = "",
  segments = 28,
): LngLatTuple[] {
  const [x0, y0] = toTuple(start);
  const [x2, y2] = toTuple(end);
  const dx = x2 - x0;
  const dy = y2 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return [[x0, y0], [x2, y2]];
  const normalX = -dy / length;
  const normalY = dx / length;
  const bend = Math.min(0.18, Math.max(0.035, length * 0.00018));
  const sign = hashSign(seed || `${x0},${y0},${x2},${y2}`);
  const controlX = (x0 + x2) / 2 + normalX * length * bend * sign;
  const controlY = (y0 + y2) / 2 + normalY * length * bend * sign;
  const points: LngLatTuple[] = [];
  const steps = Math.max(8, segments);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const oneMinus = 1 - t;
    points.push([
      oneMinus * oneMinus * x0 + 2 * oneMinus * t * controlX + t * t * x2,
      oneMinus * oneMinus * y0 + 2 * oneMinus * t * controlY + t * t * y2,
    ]);
  }
  return points;
}

/** Point at a fraction (0–1) along a curved route, for label placement. */
export function curvedPointAt(
  start: LngLatLike,
  end: LngLatLike,
  seed = "",
  fraction = 0.5,
): LngLatTuple {
  const points = curvedLine(start, end, seed, 24);
  const index = Math.min(
    points.length - 1,
    Math.max(0, Math.round(fraction * (points.length - 1))),
  );
  return points[index] ?? points[0]!;
}

/** Midpoint and tangent angle (degrees clockwise from north) on a curved route. */
export function curvedMidpoint(
  start: LngLatLike,
  end: LngLatLike,
  seed = "",
): { point: LngLatTuple; angle: number } {
  const points = curvedLine(start, end, seed, 20);
  const middle = points[Math.floor(points.length / 2)] ?? points[0]!;
  const next = points[Math.min(points.length - 1, Math.floor(points.length / 2) + 1)]!;
  return {
    point: middle,
    angle: bearing(middle, next),
  };
}
