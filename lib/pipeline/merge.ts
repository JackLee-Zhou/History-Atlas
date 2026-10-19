import type {
  Citation,
  ControlArea,
  Faction,
  FrontLine,
  Period,
  Place,
  Route,
  Scene,
  Situation,
  Summary,
} from "@/lib/schema";
import { normalizeName } from "@/lib/gazetteer";
import {
  bufferedControlPolygon,
  controlAreaPaddingKm,
  type LngLat,
} from "./geometry";

export interface MergeSituationsOptions {
  titleFallback: string;
  summaryFallback: Summary;
  timeLabelFallback?: string;
  period?: Period;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function locationKey(place: Place): string {
  if (place.location) {
    return `${place.location.lat.toFixed(3)},${place.location.lng.toFixed(3)},${place.location.source}`;
  }
  return "unresolved";
}

function clonePolygon(area: ControlArea): ControlArea["geometry"] {
  return {
    type: "Polygon",
    coordinates: area.geometry.coordinates.map((ring) =>
      ring.map(([lng, lat]) => [lng, lat] as [number, number]),
    ),
  };
}

function cloneLine(line: FrontLine): FrontLine["geometry"] {
  return {
    type: "LineString",
    coordinates: line.geometry.coordinates.map(
      ([lng, lat]) => [lng, lat] as [number, number],
    ),
  };
}

/**
 * Merge per-window situations from chapter mode into one Analysis situation.
 * Every window uses local ids (p1, r1, ...), so ids and references are remapped
 * through per-window maps; no citation is ever renumbered.
 */
export function mergeSegmentSituations(
  situations: Situation[],
  options: MergeSituationsOptions,
): Situation {
  if (situations.length === 1) return situations[0]!;

  /* Factions ---------------------------------------------------------- */
  const factions: Faction[] = [];
  const factionByName = new Map<string, Faction>();
  const factionMaps: Array<Map<string, string>> = [];

  for (const situation of situations) {
    const map = new Map<string, string>();
    for (const faction of situation.factions) {
      const key = normalizeName(faction.name) || faction.name;
      let master = factionByName.get(key);
      if (!master) {
        master = {
          id: `f${factions.length + 1}`,
          name: faction.name,
          color: faction.color,
        };
        if (faction.note) master.note = faction.note;
        factions.push(master);
        factionByName.set(key, master);
      }
      map.set(faction.id, master.id);
    }
    factionMaps.push(map);
  }

  /* Places ------------------------------------------------------------ */
  const places: Place[] = [];
  const placeByKey = new Map<string, Place>();
  const placeMaps: Array<Map<string, string>> = [];

  situations.forEach((situation, situationIndex) => {
    const map = new Map<string, string>();
    const factionMap = factionMaps[situationIndex]!;
    for (const place of situation.places) {
      const key = `${normalizeName(place.name) || place.name}|${locationKey(place)}`;
      const existing = placeByKey.get(key);
      if (existing) {
        existing.evidence = dedupeStrings([...existing.evidence, ...place.evidence]);
        if (!existing.role && place.role) existing.role = place.role;
        if (!existing.modernName && place.modernName) existing.modernName = place.modernName;
        if (!existing.locationNote && place.locationNote) {
          existing.locationNote = place.locationNote;
        }
        if (!existing.factionId && place.factionId) {
          existing.factionId = factionMap.get(place.factionId) ?? undefined;
        }
        map.set(place.id, existing.id);
        continue;
      }
      const master: Place = {
        id: `p${places.length + 1}`,
        name: place.name,
        category: place.category,
        evidence: dedupeStrings(place.evidence),
      };
      if (place.factionId) {
        const mapped = factionMap.get(place.factionId);
        if (mapped) master.factionId = mapped;
      }
      if (place.role) master.role = place.role;
      if (place.modernName) master.modernName = place.modernName;
      if (place.locationNote) master.locationNote = place.locationNote;
      if (place.location) master.location = { ...place.location };
      if (place.unresolved) master.unresolved = place.unresolved;
      places.push(master);
      placeByKey.set(key, master);
      map.set(place.id, master.id);
    }
    placeMaps.push(map);
  });

  /* Routes ------------------------------------------------------------ */
  const routes: Route[] = [];
  const routeByKey = new Map<string, Route>();
  const routeMaps: Array<Map<string, string>> = [];

  situations.forEach((situation, situationIndex) => {
    const map = new Map<string, string>();
    const placeMap = placeMaps[situationIndex]!;
    const factionMap = factionMaps[situationIndex]!;
    for (const route of situation.routes) {
      const from = placeMap.get(route.fromPlaceId);
      const to = placeMap.get(route.toPlaceId);
      if (!from || !to) continue;
      const factionId = route.factionId ? factionMap.get(route.factionId) : undefined;
      const key = [from, to, route.kind, factionId ?? ""].join("|");
      const existing = routeByKey.get(key);
      if (existing) {
        existing.evidence = dedupeStrings([...existing.evidence, ...route.evidence]);
        map.set(route.id, existing.id);
        continue;
      }
      const master: Route = {
        id: `r${routes.length + 1}`,
        fromPlaceId: from,
        toPlaceId: to,
        kind: route.kind,
        evidence: dedupeStrings(route.evidence),
      };
      if (factionId) master.factionId = factionId;
      if (route.label) master.label = route.label;
      routes.push(master);
      routeByKey.set(key, master);
      map.set(route.id, master.id);
    }
    routeMaps.push(map);
  });

  /* Control areas ----------------------------------------------------- */
  const controlAreas: ControlArea[] = [];
  const areaByKey = new Map<string, ControlArea>();
  const areaMaps: Array<Map<string, string>> = [];

  situations.forEach((situation, situationIndex) => {
    const map = new Map<string, string>();
    const factionMap = factionMaps[situationIndex]!;
    for (const area of situation.controlAreas) {
      const factionId = factionMap.get(area.factionId);
      if (!factionId) continue;
      const key = `${factionId}|${area.name}`;
      const existing = areaByKey.get(key);
      if (existing) {
        existing.evidence = dedupeStrings([...existing.evidence, ...area.evidence]);
        map.set(area.id, existing.id);
        continue;
      }
      const master: ControlArea = {
        id: `a${controlAreas.length + 1}`,
        factionId,
        name: area.name,
        geometry: clonePolygon(area),
        schematic: true,
        evidence: dedupeStrings(area.evidence),
      };
      controlAreas.push(master);
      areaByKey.set(key, master);
      map.set(area.id, master.id);
    }
    areaMaps.push(map);
  });

  /* Front lines ------------------------------------------------------- */
  const frontLines: FrontLine[] = [];
  const frontLineByKey = new Map<string, FrontLine>();
  const frontLineMaps: Array<Map<string, string>> = [];

  situations.forEach((situation, situationIndex) => {
    const map = new Map<string, string>();
    const factionMap = factionMaps[situationIndex]!;
    for (const line of situation.frontLines) {
      const factionIds = dedupeStrings(
        line.factionIds
          .map((id) => factionMap.get(id))
          .filter((id): id is string => Boolean(id)),
      );
      if (factionIds.length < 2) continue;
      const key = [
        line.geometry.coordinates
          .map((point) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`)
          .join(";"),
        factionIds.slice().sort().join(","),
      ].join("|");
      const existing = frontLineByKey.get(key);
      if (existing) {
        existing.evidence = dedupeStrings([...existing.evidence, ...line.evidence]);
        if (!existing.name && line.name) existing.name = line.name;
        map.set(line.id, existing.id);
        continue;
      }
      const master: FrontLine = {
        id: `fl${frontLines.length + 1}`,
        factionIds,
        geometry: cloneLine(line),
        schematic: true,
        evidence: dedupeStrings(line.evidence),
      };
      if (line.name) master.name = line.name;
      frontLines.push(master);
      frontLineByKey.set(key, master);
      map.set(line.id, master.id);
    }
    frontLineMaps.push(map);
  });

  // Derive schematic control areas for merged factions that now have at least
  // two located places (individual windows may not have reached that count).
  for (const faction of factions) {
    if (controlAreas.some((area) => area.factionId === faction.id)) continue;
    const factionPlaces = places.filter(
      (place) => place.factionId === faction.id && place.location,
    );
    if (factionPlaces.length < 2) continue;
    const evidence = dedupeStrings(
      factionPlaces.flatMap((place) => place.evidence),
    );
    if (evidence.length === 0) continue;
    const points: LngLat[] = factionPlaces.map((place) => [
      place.location!.lng,
      place.location!.lat,
    ]);
    const geometry = bufferedControlPolygon(
      points,
      controlAreaPaddingKm(factionPlaces.map((place) => place.location!.radiusKm)),
    );
    if (!geometry) continue;
    controlAreas.push({
      id: `a${controlAreas.length + 1}`,
      factionId: faction.id,
      name: `${faction.name}控制区（示意）`,
      geometry,
      schematic: true,
      evidence,
    });
  }

  /* Scenes ------------------------------------------------------------ */
  let scenes: Scene[] = [];
  const sceneKeys = new Set<string>();

  situations.forEach((situation, situationIndex) => {
    const placeMap = placeMaps[situationIndex]!;
    const routeMap = routeMaps[situationIndex]!;
    const areaMap = areaMaps[situationIndex]!;
    const frontLineMap = frontLineMaps[situationIndex]!;
    for (const scene of situation.scenes) {
      const placeIds = dedupeStrings(
        scene.placeIds
          .map((id) => placeMap.get(id))
          .filter((id): id is string => Boolean(id)),
      );
      const routeIds = dedupeStrings(
        scene.routeIds
          .map((id) => routeMap.get(id))
          .filter((id): id is string => Boolean(id)),
      );
      const areaIds = dedupeStrings(
        scene.areaIds
          .map((id) => areaMap.get(id))
          .filter((id): id is string => Boolean(id)),
      );
      const frontLineIds = dedupeStrings(
        scene.frontLineIds
          .map((id) => frontLineMap.get(id))
          .filter((id): id is string => Boolean(id)),
      );
      const key = [
        scene.title,
        scene.summary,
        placeIds.join(","),
        routeIds.join(","),
        areaIds.join(","),
        frontLineIds.join(","),
      ].join("|");
      if (sceneKeys.has(key)) continue;
      sceneKeys.add(key);
      const master: Scene = {
        id: `s${scenes.length + 1}`,
        index: scenes.length,
        title: scene.title,
        summary: scene.summary,
        placeIds,
        routeIds,
        areaIds,
        frontLineIds,
      };
      if (scene.timeLabel) master.timeLabel = scene.timeLabel;
      if (scene.camera) master.camera = { ...scene.camera };
      scenes.push(master);
    }
  });

  // Each window produced its own "全篇概览" scene. Keep one consolidated
  // overview for the whole chapter instead of showing duplicate overviews.
  const overviewScenes = scenes.filter((scene) => scene.title.includes("概览"));
  if (overviewScenes.length > 1) {
    const mergedOverview: Scene = {
      id: "s-overview",
      index: 0,
      title: "全篇概览",
      summary: options.summaryFallback.overview,
      placeIds: places.map((place) => place.id),
      routeIds: routes.map((route) => route.id),
      areaIds: controlAreas.map((area) => area.id),
      frontLineIds: frontLines.map((line) => line.id),
    };
    if (overviewScenes[0]?.timeLabel) {
      mergedOverview.timeLabel = overviewScenes[0].timeLabel;
    }
    scenes = [
      mergedOverview,
      ...scenes
        .filter((scene) => !scene.title.includes("概览"))
        .map((scene, index) => ({ ...scene, index: index + 1 })),
    ];
  }

  if (scenes.length === 0) {
    scenes.push({
      id: "s1",
      index: 0,
      title: options.titleFallback,
      summary: options.summaryFallback.overview,
      placeIds: places.map((place) => place.id),
      routeIds: routes.map((route) => route.id),
      areaIds: controlAreas.map((area) => area.id),
      frontLineIds: frontLines.map((line) => line.id),
    });
  }

  // The frontend filters control areas by scene refs; attach merged areas to
  // scenes that contain at least one of the faction's places.
  for (const scene of scenes) {
    const scenePlaceIds = new Set(scene.placeIds);
    for (const area of controlAreas) {
      if (scene.areaIds.includes(area.id)) continue;
      const hasFactionPlace = places.some(
        (place) =>
          place.factionId === area.factionId && scenePlaceIds.has(place.id),
      );
      if (hasFactionPlace) scene.areaIds.push(area.id);
    }
  }

  /* Summary + citations ---------------------------------------------- */
  const overview =
    situations
      .slice()
      .sort((a, b) => b.places.length - a.places.length)
      .map((situation) => situation.summary.overview)
      .find(Boolean) ?? options.summaryFallback.overview;
  const summary: Summary = {
    overview,
    keyPoints: dedupeStrings(
      situations.flatMap((situation) => situation.summary.keyPoints),
    ).slice(0, 12),
    uncertainty: dedupeStrings(
      situations.flatMap((situation) => situation.summary.uncertainty),
    ).slice(0, 12),
  };

  const citationMap = new Map<string, Citation>();
  for (const situation of situations) {
    for (const citation of situation.citations) {
      if (!citationMap.has(citation.id)) citationMap.set(citation.id, citation);
    }
  }
  const used = new Set<string>([
    ...places.flatMap((place) => place.evidence),
    ...routes.flatMap((route) => route.evidence),
    ...controlAreas.flatMap((area) => area.evidence),
    ...frontLines.flatMap((line) => line.evidence),
  ]);
  const citations = [...citationMap.values()]
    .filter((citation) => used.has(citation.id))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const timeLabel =
    situations.map((situation) => situation.timeLabel).find(Boolean) ??
    options.timeLabelFallback;
  const title =
    situations.map((situation) => situation.title).find(Boolean) ??
    options.titleFallback;

  const merged: Situation = {
    title,
    summary,
    factions,
    places,
    routes,
    controlAreas,
    frontLines,
    scenes,
    citations,
  };
  if (timeLabel) merged.timeLabel = timeLabel;
  if (options.period) merged.period = options.period;
  return merged;
}

/** Convert a location tuple without losing TypeScript's tuple type. */
export function toLngLat(lng: number, lat: number): LngLat {
  return [lng, lat];
}
