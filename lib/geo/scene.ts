import { DEFAULT_FACTION_COLOR } from "@/lib/constants";
import type {
  Analysis,
  ControlArea,
  Faction,
  FrontLine,
  Place,
  Route,
  Scene,
} from "@/lib/schema";

/**
 * Resolve the active scene. `sceneIndex` is normally the scene's array position,
 * but we also accept the persisted `Scene.index` value when the two diverge.
 */
export function getScene(
  analysis: Analysis,
  sceneIndex: number,
): Scene | null {
  const scenes = analysis.situation.scenes;
  if (!Number.isFinite(sceneIndex)) return null;
  const byStoredIndex = scenes.find((scene) => scene.index === sceneIndex);
  if (byStoredIndex) return byStoredIndex;
  const byPosition = scenes[sceneIndex];
  return byPosition ?? null;
}

export function findFaction(
  analysis: Analysis,
  factionId: string | undefined,
): Faction | undefined {
  if (!factionId) return undefined;
  return analysis.situation.factions.find((faction) => faction.id === factionId);
}

export function factionColor(
  analysis: Analysis,
  factionId: string | undefined,
): string {
  return findFaction(analysis, factionId)?.color ?? DEFAULT_FACTION_COLOR;
}

/** Displayable places: located, and referenced by the scene (all when no scene). */
export function scenePlaces(
  analysis: Analysis,
  scene: Scene | null,
): Place[] {
  const places = analysis.situation.places.filter((place) => place.location);
  if (!scene) return places;
  const ids = new Set(scene.placeIds);
  return places.filter((place) => ids.has(place.id));
}

/** Valid routes: both endpoints exist and carry coordinates. */
export function sceneRoutes(
  analysis: Analysis,
  scene: Scene | null,
): Route[] {
  const placeById = new Map(
    analysis.situation.places.map((place) => [place.id, place] as const),
  );
  const routes = analysis.situation.routes.filter((route) => {
    const from = placeById.get(route.fromPlaceId);
    const to = placeById.get(route.toPlaceId);
    return Boolean(from?.location && to?.location);
  });
  if (!scene) return routes;
  const ids = new Set(scene.routeIds);
  return routes.filter((route) => ids.has(route.id));
}

export function sceneAreas(
  analysis: Analysis,
  scene: Scene | null,
): ControlArea[] {
  const areas = analysis.situation.controlAreas;
  if (!scene) return areas;
  // A broad faction area combined with a single standoff point zooms the map
  // back to the whole theater and hides the local contact line. Keep areas for
  // multi-place scenes; one-place scenes should focus on the point/front line.
  if (scene.placeIds.length <= 1) return [];
  const ids = new Set(scene.areaIds);
  return areas.filter((area) => ids.has(area.id));
}

export function sceneFrontLines(
  analysis: Analysis,
  scene: Scene | null,
): FrontLine[] {
  const lines = analysis.situation.frontLines;
  if (!scene) return lines;
  const ids = new Set(scene.frontLineIds);
  return lines.filter((line) => ids.has(line.id));
}
