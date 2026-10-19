import {
  sceneAreas,
  sceneFrontLines,
  sceneRoutes,
} from "@/lib/geo";
import type { AtlasSelection } from "@/lib/geo";
import type {
  Analysis,
  Citation,
  ControlArea,
  FrontLine,
  Place,
  Route,
  Scene,
} from "@/lib/schema";

export type ResolvedSelection =
  | { type: "place"; place: Place }
  | { type: "route"; route: Route }
  | { type: "area"; area: ControlArea }
  | { type: "frontline"; frontline: FrontLine };

export function resolveSelection(
  analysis: Analysis,
  selection: AtlasSelection | null,
): ResolvedSelection | null {
  if (!selection) return null;
  const situation = analysis.situation;

  if (selection.type === "place") {
    const place = situation.places.find((item) => item.id === selection.id);
    return place ? { type: "place", place } : null;
  }
  if (selection.type === "route") {
    const route = situation.routes.find((item) => item.id === selection.id);
    return route ? { type: "route", route } : null;
  }
  if (selection.type === "area") {
    const area = situation.controlAreas.find(
      (item) => item.id === selection.id,
    );
    return area ? { type: "area", area } : null;
  }
  const frontline = situation.frontLines.find(
    (item) => item.id === selection.id,
  );
  return frontline ? { type: "frontline", frontline } : null;
}

export function selectionEvidenceIds(selection: ResolvedSelection): string[] {
  switch (selection.type) {
    case "place":
      return selection.place.evidence;
    case "route":
      return selection.route.evidence;
    case "area":
      return selection.area.evidence;
    case "frontline":
      return selection.frontline.evidence;
  }
}

/** Evidence referenced by any feature in the scene (all features when no scene). */
export function sceneEvidenceIds(
  analysis: Analysis,
  scene: Scene | null,
): string[] {
  const ids: string[] = [];
  const add = (values: readonly string[]) => ids.push(...values);

  // Include unresolved places too: their evidence is exactly what the
  // "待考" panel needs, even though they are never drawn on the map.
  const scenePlaceIds = scene ? new Set(scene.placeIds) : null;
  for (const place of analysis.situation.places) {
    if (scenePlaceIds && !scenePlaceIds.has(place.id)) continue;
    add(place.evidence);
  }
  for (const route of sceneRoutes(analysis, scene)) add(route.evidence);
  for (const area of sceneAreas(analysis, scene)) add(area.evidence);
  for (const line of sceneFrontLines(analysis, scene)) add(line.evidence);
  return Array.from(new Set(ids));
}

export function resolveCitations(
  citations: readonly Citation[],
  ids: readonly string[],
): Citation[] {
  const byId = new Map(citations.map((citation) => [citation.id, citation]));
  return Array.from(new Set(ids))
    .map((id) => byId.get(id))
    .filter((citation): citation is Citation => Boolean(citation));
}
