import type {
  Feature,
  FeatureCollection,
  LineString,
  Point,
  Polygon,
} from "geojson";
import type { Analysis, Faction, Place, Route, Scene } from "@/lib/schema";
import { DEFAULT_FACTION_COLOR } from "@/lib/constants";
import {
  circlePolygon,
  curvedLine,
  curvedMidpoint,
  needsAccuracyRing,
} from "./geometry";
import {
  factionColor,
  getScene,
  sceneAreas,
  sceneFrontLines,
  scenePlaces,
  sceneRoutes,
} from "./scene";
import type {
  AccuracyFeatureCollection,
  AccuracyFeatureProperties,
  ArrowFeatureCollection,
  ArrowFeatureProperties,
  Bounds,
  ControlAreaFeatureCollection,
  ControlAreaFeatureProperties,
  FrontLineFeatureCollection,
  FrontLineFeatureProperties,
  FrontLineTickFeatureCollection,
  LngLatTuple,
  RouteFeatureCollection,
  RouteFeatureProperties,
} from "./types";
import { routeEffect } from "./effects";

function coordinatesOf(place: Place): LngLatTuple | null {
  if (!place.location) return null;
  return [place.location.lng, place.location.lat];
}

function placeIndex(places: readonly Place[]): Map<string, Place> {
  return new Map(places.map((place) => [place.id, place] as const));
}

export function routeFeatureCollection(
  analysis: Analysis,
  scene: Scene | null,
): RouteFeatureCollection {
  const placeById = placeIndex(analysis.situation.places);
  const factionName = new Map(
    analysis.situation.factions.map((faction) => [faction.id, faction.name] as const),
  );
  const features: Feature<LineString, RouteFeatureProperties>[] = [];

  for (const route of sceneRoutes(analysis, scene)) {
    const from = placeById.get(route.fromPlaceId);
    const to = placeById.get(route.toPlaceId);
    const start = from ? coordinatesOf(from) : null;
    const end = to ? coordinatesOf(to) : null;
    if (!start || !end) continue;
    const preset = routeEffect(route.kind);
    features.push({
      type: "Feature",
      properties: {
        id: route.id,
        factionId: route.factionId,
        color: factionColor(analysis, route.factionId),
        label: route.label ?? "",
        kind: route.kind,
        effect: preset.kind,
        fromName: from?.name ?? route.fromPlaceId,
        toName: to?.name ?? route.toPlaceId,
        factionName: route.factionId
          ? (factionName.get(route.factionId) ?? "未标记势力")
          : "未标记势力",
      },
      geometry: {
        type: "LineString",
        coordinates: curvedLine(start, end, route.id).map(
          ([lng, lat]) => [lng, lat],
        ),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** Midpoint arrow markers for each route with two located endpoints. */
export function arrowFeatures(
  routes: readonly Route[],
  places: readonly Place[],
  factions: readonly Faction[] = [],
): ArrowFeatureCollection {
  const placeById = placeIndex(places);
  const colorByFaction = new Map(
    factions.map((faction) => [faction.id, faction.color] as const),
  );
  const features: Feature<Point, ArrowFeatureProperties>[] = [];

  for (const route of routes) {
    const from = placeById.get(route.fromPlaceId);
    const to = placeById.get(route.toPlaceId);
    const start = from ? coordinatesOf(from) : null;
    const end = to ? coordinatesOf(to) : null;
    if (!start || !end) continue;
    const curve = curvedMidpoint(start, end, route.id);
    const [lng, lat] = curve.point;
    features.push({
      type: "Feature",
      properties: {
        id: route.id,
        angle: curve.angle,
        color:
          (route.factionId && colorByFaction.get(route.factionId)) ||
          DEFAULT_FACTION_COLOR,
      },
      geometry: { type: "Point", coordinates: [lng, lat] },
    });
  }

  return { type: "FeatureCollection", features };
}

export function areaFeatureCollection(
  analysis: Analysis,
  scene: Scene | null,
): ControlAreaFeatureCollection {
  const features: Feature<Polygon, ControlAreaFeatureProperties>[] =
    sceneAreas(analysis, scene).map((area) => ({
      type: "Feature",
      properties: {
        id: area.id,
        name: area.name,
        factionId: area.factionId,
        color: factionColor(analysis, area.factionId),
      },
      geometry: {
        type: "Polygon",
        coordinates: area.geometry.coordinates.map((ring) =>
          ring.map((position) => [position[0], position[1]]),
        ),
      },
    }));
  return { type: "FeatureCollection", features };
}

export function frontLineFeatureCollection(
  analysis: Analysis,
  scene: Scene | null,
): FrontLineFeatureCollection {
  const features: Feature<LineString, FrontLineFeatureProperties>[] = [];
  for (const line of sceneFrontLines(analysis, scene)) {
    features.push({
      type: "Feature",
      properties: {
        id: line.id,
        name: line.name,
        color: "#9b2c2c",
        factionIds: line.factionIds,
      },
      geometry: {
        type: "LineString",
        coordinates: line.geometry.coordinates.map((position) => [
          position[0],
          position[1],
        ]),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** Dashed accuracy rings as circle polygons, rendered by a GeoJSON line layer. */
export function placeAccuracyFeatureCollection(
  analysis: Analysis,
  scene: Scene | null,
): AccuracyFeatureCollection {
  const features: Feature<Polygon, AccuracyFeatureProperties>[] = [];

  for (const place of scenePlaces(analysis, scene)) {
    if (!place.location || !needsAccuracyRing(place)) continue;
    const center: LngLatTuple = [place.location.lng, place.location.lat];
    const circle = circlePolygon(center, place.location.radiusKm);
    features.push({
      type: "Feature",
      properties: {
        id: place.id,
        name: place.name,
        color: factionColor(analysis, place.factionId),
        confidence: place.location.confidence,
        precision: place.location.precision,
        radiusKm: place.location.radiusKm,
      },
      geometry: circle.geometry,
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Perpendicular ticks along a front line. Rendering these on a separate source
 * makes a standoff look like a military contact line rather than a lone dash.
 */
export function frontLineTickCollection(
  analysis: Analysis,
  scene: Scene | null,
): FrontLineTickFeatureCollection {
  const features: FrontLineTickFeatureCollection["features"] = [];
  for (const line of sceneFrontLines(analysis, scene)) {
    const coords = line.geometry.coordinates;
    for (let index = 0; index < coords.length - 1; index += 1) {
      const [x1, y1] = coords[index]!;
      const [x2, y2] = coords[index + 1]!;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      const nx = -dy / length;
      const ny = dx / length;
      const tick = Math.min(0.16, Math.max(0.035, length * 0.12));
      for (const fraction of [0.18, 0.38, 0.58, 0.78, 0.94]) {
        const cx = x1 + dx * fraction;
        const cy = y1 + dy * fraction;
        features.push({
          type: "Feature",
          properties: { id: line.id },
          geometry: {
            type: "LineString",
            coordinates: [
              [cx - nx * tick, cy - ny * tick],
              [cx + nx * tick, cy + ny * tick],
            ],
          },
        });
      }
    }
  }
  return { type: "FeatureCollection", features };
}

/** Union bounds of every drawable feature in the scene, or null when none. */
export function featureBounds(
  analysis: Analysis,
  sceneIndex: number,
): Bounds | null {
  const scene = getScene(analysis, sceneIndex);
  const points: LngLatTuple[] = [];
  const placeById = placeIndex(analysis.situation.places);

  for (const place of scenePlaces(analysis, scene)) {
    const coordinate = coordinatesOf(place);
    if (coordinate) points.push(coordinate);
  }

  for (const route of sceneRoutes(analysis, scene)) {
    const from = placeById.get(route.fromPlaceId);
    const to = placeById.get(route.toPlaceId);
    const start = from ? coordinatesOf(from) : null;
    const end = to ? coordinatesOf(to) : null;
    if (start) points.push(start);
    if (end) points.push(end);
  }

  for (const area of sceneAreas(analysis, scene)) {
    for (const ring of area.geometry.coordinates) {
      for (const position of ring) points.push([position[0], position[1]]);
    }
  }

  for (const line of sceneFrontLines(analysis, scene)) {
    for (const position of line.geometry.coordinates) {
      points.push([position[0], position[1]]);
    }
  }

  if (points.length === 0) return null;

  let west = points[0][0];
  let south = points[0][1];
  let east = points[0][0];
  let north = points[0][1];
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

/** Convenience for empty GeoJSON sources and tests. */
export function emptyFeatureCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
