import {
  DEFAULT_FACTION_COLOR,
  FACTION_COLORS,
} from "@/lib/constants";
import type {
  ControlArea,
  Faction,
  FrontLine,
  Place,
  Period,
  Route,
  Scene,
  Situation,
  Summary,
  Warning,
} from "@/lib/schema";
import { warning } from "@/lib/utils";
import type { CitationRegistry } from "./evidence";
import { quotesFromEvidence } from "./evidence";
import {
  bufferedControlPolygon,
  cameraForPoints,
  controlAreaPaddingKm,
  type LngLat,
} from "./geometry";
import type {
  ModelFactionDraft,
  ModelSituationDraft,
  PlaceSeed,
} from "./types";

const STANDOFF_CUE_RE =
  /据险|营垒|自守|对垒|相持|僵持|布阵|列阵|结营|扎营|固守|坚守|按兵不动|不敢轻举妄动/;
/** Strong cues that justify deriving a front line from raw text alone. */
const STANDOFF_STRONG_RE =
  /据险|营垒|自守|对垒|布阵|列阵|结营|扎营|固守|坚守/;

function citationStart(
  id: string | undefined,
  byId: Map<string, number>,
): number | undefined {
  return id ? byId.get(id) : undefined;
}

function distanceDegrees(a: LngLat, b: LngLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * Math.cos(lat), a[1] - b[1]);
}

/** A short contact line across the defended position, perpendicular to the enemy. */
function derivedStandoffLine(place: LngLat, enemy?: LngLat): [number, number][] {
  const dx = enemy ? enemy[0] - place[0] : 0;
  const dy = enemy ? enemy[1] - place[1] : 1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const half = 0.22;
  return [
    [place[0] - nx * half, place[1] - ny * half],
    [place[0] + nx * half, place[1] + ny * half],
  ];
}

export interface AssembleInput {
  registry: CitationRegistry;
  /** The exact segment text; used for deterministic standoff/fortify cues. */
  text?: string;
  seeds: PlaceSeed[];
  draft: ModelSituationDraft | null;
  titleFallback: string;
  summaryFallback: Summary;
  timeLabelFallback?: string;
  period?: Period;
  addWarning: (value: Warning) => void;
}

export interface AssembleResult {
  situation: Situation;
  dropped: {
    places: number;
    routes: number;
    controlAreas: number;
    frontLines: number;
  };
}

const ROUTE_KINDS = new Set([
  "advance",
  "retreat",
  "reinforce",
  "transport",
  "other",
]);

const ROUTE_KIND_ALIASES: Record<string, Route["kind"]> = {
  进军: "advance",
  东下: "advance",
  南下: "advance",
  北上: "advance",
  西进: "advance",
  推进: "advance",
  退却: "retreat",
  撤退: "retreat",
  败退: "retreat",
  增援: "reinforce",
  援军: "reinforce",
  转运: "transport",
  粮道: "transport",
  移动: "other",
};

function normalizeRouteKind(value: string | undefined): Route["kind"] | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (ROUTE_KINDS.has(trimmed)) return trimmed as Route["kind"];
  return ROUTE_KIND_ALIASES[trimmed] ?? null;
}

function normalizeIdRef(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isValidColor(value: string | undefined): boolean {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function sliceText(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function assembleSituation(input: AssembleInput): AssembleResult {
  const {
    registry,
    seeds,
    draft,
    titleFallback,
    summaryFallback,
    timeLabelFallback,
    period,
    addWarning,
  } = input;

  const dropped = { places: 0, routes: 0, controlAreas: 0, frontLines: 0 };

  /* ------------------------------------------------------------------ */
  /* Top-level evidence pool (optional model field)                      */
  /* ------------------------------------------------------------------ */

  // The prompt asks for per-feature `evidence`, but some models emit a single
  // top-level evidence list with refs. Validate those quotes first and let
  // each feature claim citations by raw id/name.
  const topEvidenceByRef = new Map<string, string[]>();
  for (const evidenceDraft of draft?.evidence ?? []) {
    const quote = evidenceDraft.quote?.trim();
    if (!quote) continue;
    const citation = registry.add(quote);
    if (!citation) {
      addWarning(
        warning(
          "INVALID_CITATION",
          "模型给出的整体证据无法在原文中逐字找到，已丢弃该引用。",
          "warning",
          [],
        ),
      );
      continue;
    }
    for (const ref of evidenceDraft.refs ?? []) {
      const key = ref.trim();
      if (!key) continue;
      const list = topEvidenceByRef.get(key);
      if (list) list.push(citation.id);
      else topEvidenceByRef.set(key, [citation.id]);
    }
  }
  const topEvidenceFor = (refs: Array<string | undefined>): string[] => {
    const ids: string[] = [];
    for (const ref of refs) {
      const key = ref?.trim();
      if (!key) continue;
      ids.push(...(topEvidenceByRef.get(key) ?? []));
    }
    return dedupeStrings(ids);
  };

  /* ------------------------------------------------------------------ */
  /* Places (already resolved server-side)                               */
  /* ------------------------------------------------------------------ */

  const places: Place[] = [];
  const placeByRef = new Map<string, Place>();
  const placeById = new Map<string, Place>();

  for (const seed of seeds) {
    const evidence = dedupeStrings([
      ...seed.evidence,
      ...topEvidenceFor([seed.id, seed.name]),
    ]).filter((id) => registry.has(id));
    if (evidence.length === 0) {
      dropped.places += 1;
      addWarning(
        warning(
          "EVIDENCE_MISSING",
          `地点“${seed.name}”缺少可在原文中定位的证据，已丢弃。`,
          "warning",
          [seed.id],
        ),
      );
      continue;
    }
    const place: Place = {
      id: seed.id,
      name: seed.name,
      category: seed.category,
      evidence,
    };
    const factionId = seed.factionId?.trim();
    if (factionId) place.factionId = factionId;
    const role = sliceText(seed.role, 200);
    if (role) place.role = role;
    const modernName = sliceText(seed.modernName, 200);
    if (modernName) place.modernName = modernName;
    const locationNote = sliceText(seed.locationNote, 500);
    if (locationNote) place.locationNote = locationNote;
    if (seed.location) place.location = seed.location;
    if (seed.unresolved) place.unresolved = seed.unresolved;

    places.push(place);
    placeById.set(place.id, place);
    placeByRef.set(place.id, place);
    placeByRef.set(place.name, place);
  }

  const resolvePlace = (ref: string | undefined): Place | undefined => {
    const key = normalizeIdRef(ref);
    if (!key) return undefined;
    return placeByRef.get(key) ?? placeById.get(key);
  };

  /* ------------------------------------------------------------------ */
  /* Factions                                                            */
  /* ------------------------------------------------------------------ */

  const factions: Faction[] = [];
  const factionByRef = new Map<string, Faction>();
  const rawFactionDrafts = (draft?.factions ?? []) as ModelFactionDraft[];

  for (const factionDraft of rawFactionDrafts) {
    const name = factionDraft.name.trim();
    if (!name) continue;
    const existingByName = factions.find((faction) => faction.name === name);
    if (existingByName) {
      if (factionDraft.id) factionByRef.set(factionDraft.id.trim(), existingByName);
      factionByRef.set(name, existingByName);
      continue;
    }
    const id = `f${factions.length + 1}`;
    const color = isValidColor(factionDraft.color)
      ? factionDraft.color!
      : FACTION_COLORS[factions.length % FACTION_COLORS.length] ??
        DEFAULT_FACTION_COLOR;
    const faction: Faction = { id, name, color };
    const note = sliceText(factionDraft.note, 500);
    if (note) faction.note = note;
    factions.push(faction);
    factionByRef.set(id, faction);
    factionByRef.set(name, faction);
    if (factionDraft.id) factionByRef.set(factionDraft.id.trim(), faction);
  }

  const resolveFaction = (ref: string | undefined): Faction | undefined => {
    const key = normalizeIdRef(ref);
    if (!key) return undefined;
    return factionByRef.get(key);
  };

  // Model-provided role/faction annotations for resolved places.
  for (const roleDraft of draft?.places ?? []) {
    const place = resolvePlace(roleDraft.placeId) ?? resolvePlace(roleDraft.name);
    if (!place) {
      addWarning(
        warning(
          "UNKNOWN_PLACE_REF",
          "模型引用了一个不在服务端地点清单中的地点，已忽略该引用（模型不得自行新增地点或坐标）。",
          "warning",
          [],
        ),
      );
      continue;
    }
    const rawFaction = normalizeIdRef(roleDraft.factionId);
    if (rawFaction) {
      const faction = resolveFaction(rawFaction);
      if (faction) {
        place.factionId = faction.id;
      } else {
        addWarning(
          warning(
            "UNKNOWN_FACTION_REF",
            `地点“${place.name}”引用了未声明的势力，已忽略势力归属。`,
            "warning",
            [place.id],
          ),
        );
      }
    }
    const role = sliceText(roleDraft.role, 200);
    if (role) place.role = role;

    const topLevel = topEvidenceFor([roleDraft.placeId, roleDraft.name]);
    if (topLevel.length > 0) {
      place.evidence = dedupeStrings([...place.evidence, ...topLevel]);
    }

    const extraQuotes = quotesFromEvidence(roleDraft.evidence);
    for (const quote of extraQuotes) {
      const citation = registry.add(quote);
      if (!citation) {
        addWarning(
          warning(
            "INVALID_CITATION",
            `地点“${place.name}”的补充引文无法在原文中逐字找到，已丢弃该引文。`,
            "warning",
            [place.id],
          ),
        );
        continue;
      }
      place.evidence = dedupeStrings([...place.evidence, citation.id]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Routes                                                              */
  /* ------------------------------------------------------------------ */

  const routes: Route[] = [];
  const routeByRef = new Map<string, Route>();
  const routeByKey = new Map<string, Route>();

  const addRoute = (route: Route, rawId?: string): void => {
    const key = [route.fromPlaceId, route.toPlaceId, route.kind, route.factionId ?? ""].join("|");
    const existing = routeByKey.get(key);
    if (existing) {
      existing.evidence = dedupeStrings([...existing.evidence, ...route.evidence]);
      if (rawId) routeByRef.set(rawId, existing);
      routeByRef.set(route.id, existing);
      return;
    }
    routes.push(route);
    routeByKey.set(key, route);
    routeByRef.set(route.id, route);
    if (rawId) routeByRef.set(rawId, route);
  };

  for (const routeDraft of draft?.routes ?? []) {
    const from = resolvePlace(routeDraft.fromPlaceId);
    const to = resolvePlace(routeDraft.toPlaceId);
    if (!from || !to || from.id === to.id) {
      dropped.routes += 1;
      addWarning(
        warning(
          "DANGLING_ROUTE",
          "路线引用了不存在的地点或起讫点相同，已丢弃该路线。",
          "warning",
          [from?.id ?? "", to?.id ?? ""].filter(Boolean),
        ),
      );
      continue;
    }
    if (!from.location || !to.location) {
      dropped.routes += 1;
      addWarning(
        warning(
          "ROUTE_UNRESOLVED_ENDPOINT",
          "路线端点尚未定位，无法绘制路线，已丢弃该路线。",
          "warning",
          [from.id, to.id],
        ),
      );
      continue;
    }

    const kind = normalizeRouteKind(routeDraft.kind);
    if (!kind) {
      addWarning(
        warning(
          "ROUTE_KIND_UNKNOWN",
          `路线“${from.name}—${to.name}”的类型无法识别，已按“其他”处理。`,
          "info",
          [from.id, to.id],
        ),
      );
    }

    const evidence: string[] = topEvidenceFor([
      routeDraft.id,
      routeDraft.fromPlaceId,
      routeDraft.toPlaceId,
    ]);
    for (const quote of quotesFromEvidence(routeDraft.evidence)) {
      const citation = registry.add(quote);
      if (!citation) {
        addWarning(
          warning(
            "INVALID_CITATION",
            `路线“${from.name}—${to.name}”的证据无法在原文中逐字找到，已丢弃该引用。`,
            "warning",
            [from.id, to.id],
          ),
        );
        continue;
      }
      evidence.push(citation.id);
    }
    if (evidence.length === 0) {
      dropped.routes += 1;
      addWarning(
        warning(
          "EVIDENCE_MISSING",
          `路线“${from.name}—${to.name}”缺少可验证证据，已丢弃。`,
          "warning",
          [from.id, to.id],
        ),
      );
      continue;
    }

    let factionId: string | undefined;
    const rawFaction = normalizeIdRef(routeDraft.factionId);
    if (rawFaction) {
      const faction = resolveFaction(rawFaction);
      if (faction) factionId = faction.id;
      else {
        addWarning(
          warning(
            "UNKNOWN_FACTION_REF",
            `路线“${from.name}—${to.name}”引用了未声明的势力，已忽略势力归属。`,
            "warning",
            [],
          ),
        );
      }
    }

    const route: Route = {
      id: `r${routes.length + 1}`,
      fromPlaceId: from.id,
      toPlaceId: to.id,
      kind: kind ?? "other",
      evidence: dedupeStrings(evidence),
    };
    if (factionId) route.factionId = factionId;
    const label = sliceText(routeDraft.label, 200);
    if (label) route.label = label;
    addRoute(route, normalizeIdRef(routeDraft.id));
  }

  /* ------------------------------------------------------------------ */
  /* Control areas (convex hull + buffer, schematic)                     */
  /* ------------------------------------------------------------------ */

  const controlAreas: ControlArea[] = [];
  const areaByRef = new Map<string, ControlArea>();
  const areaByFaction = new Map<string, ControlArea>();
  const areaMembers = new Map<string, string[]>();

  const addControlArea = (
    faction: Faction,
    areaPlaces: Place[],
    name: string,
    evidence: string[],
    rawId?: string,
  ): void => {
    const located = areaPlaces.filter((place) => place.location);
    if (located.length < 2) return;
    const points = located.map(
      (place) => [place.location!.lng, place.location!.lat] as LngLat,
    );
    const padKm = controlAreaPaddingKm(
      located.map((place) => place.location!.radiusKm),
    );
    const geometry = bufferedControlPolygon(points, padKm);
    if (!geometry) return;
    const area: ControlArea = {
      id: `a${controlAreas.length + 1}`,
      factionId: faction.id,
      name: name || `${faction.name}示意控制区`,
      geometry,
      schematic: true,
      evidence: dedupeStrings(evidence),
    };
    controlAreas.push(area);
    areaByRef.set(area.id, area);
    if (rawId) areaByRef.set(rawId, area);
    areaByFaction.set(faction.id, area);
    areaMembers.set(area.id, located.map((place) => place.id));
  };

  for (const areaDraft of draft?.controlAreas ?? []) {
    let faction = resolveFaction(areaDraft.factionId);
    const areaPlaces = (areaDraft.placeIds ?? [])
      .map((id) => resolvePlace(id))
      .filter((place): place is Place => Boolean(place));
    if (!faction) {
      const inferred = areaPlaces
        .map((place) => place.factionId)
        .find((id): id is string => Boolean(id));
      faction = inferred ? factions.find((item) => item.id === inferred) : undefined;
    }
    if (!faction) {
      addWarning(
        warning(
          "UNKNOWN_FACTION_REF",
          "控制区缺少有效势力归属，已丢弃。",
          "warning",
          areaPlaces.map((place) => place.id),
        ),
      );
      continue;
    }
    const evidence: string[] = topEvidenceFor([
      areaDraft.id,
      ...(areaDraft.placeIds ?? []),
    ]);
    for (const quote of quotesFromEvidence(areaDraft.evidence)) {
      const citation = registry.add(quote);
      if (citation) evidence.push(citation.id);
      else {
        addWarning(
          warning(
            "INVALID_CITATION",
            "控制区的证据无法在原文中逐字找到，已丢弃该引用。",
            "warning",
            areaPlaces.map((place) => place.id),
          ),
        );
      }
    }
    if (evidence.length === 0) {
      dropped.controlAreas += 1;
      addWarning(
        warning(
          "EVIDENCE_MISSING",
          "控制区缺少可验证证据，已丢弃。",
          "warning",
          areaPlaces.map((place) => place.id),
        ),
      );
      continue;
    }
    if (areaPlaces.filter((place) => place.location).length < 2) {
      dropped.controlAreas += 1;
      addWarning(
        warning(
          "CONTROL_AREA_INSUFFICIENT_PLACES",
          "控制区至少需要 2 个已定位地点，已丢弃。",
          "warning",
          areaPlaces.map((place) => place.id),
        ),
      );
      continue;
    }
    addControlArea(
      faction,
      areaPlaces,
      areaDraft.name?.trim() || `${faction.name}示意控制区`,
      evidence,
      normalizeIdRef(areaDraft.id),
    );
  }

  // Derive schematic control areas for factions whose places form a cluster
  // and which the model did not already describe explicitly.
  for (const faction of factions) {
    if (areaByFaction.has(faction.id)) continue;
    const factionPlaces = places.filter(
      (place) => place.factionId === faction.id && place.location,
    );
    if (factionPlaces.length < 2) continue;
    const evidence = dedupeStrings(factionPlaces.flatMap((place) => place.evidence));
    if (evidence.length === 0) continue;
    addControlArea(
      faction,
      factionPlaces,
      `${faction.name}控制区（示意）`,
      evidence,
    );
  }

  /* ------------------------------------------------------------------ */
  /* Front lines                                                         */
  /* ------------------------------------------------------------------ */

  const frontLines: FrontLine[] = [];
  const frontLineByRef = new Map<string, FrontLine>();

  for (const lineDraft of draft?.frontLines ?? []) {
    const refs = dedupeStrings([
      ...(lineDraft.betweenPlaceIds ?? []),
      ...(lineDraft.placeIds ?? []),
      lineDraft.placeIdA ?? "",
      lineDraft.placeIdB ?? "",
    ]);
    const endpoints = refs
      .map((ref) => resolvePlace(ref))
      .filter((place): place is Place => Boolean(place?.location));
    if (endpoints.length < 2) {
      dropped.frontLines += 1;
      addWarning(
        warning(
          "DANGLING_FRONTLINE",
          "对峙线端点不存在或尚未定位，已丢弃该对峙线。",
          "warning",
          [],
        ),
      );
      continue;
    }
    const [a, b] = endpoints as [Place, Place];

    let factionIds = dedupeStrings(
      (lineDraft.factionIds ?? [])
        .map((raw) => resolveFaction(raw)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    if (factionIds.length < 2) {
      factionIds = dedupeStrings(
        [a.factionId, b.factionId].filter((id): id is string => Boolean(id)),
      );
    }
    if (factionIds.length < 2) {
      dropped.frontLines += 1;
      addWarning(
        warning(
          "FRONTLINE_FACTION_MISSING",
          "对峙线需要两个不同势力的端点，已丢弃该对峙线。",
          "warning",
          [a.id, b.id],
        ),
      );
      continue;
    }

    const evidence: string[] = topEvidenceFor([
      lineDraft.id,
      ...(lineDraft.betweenPlaceIds ?? []),
      ...(lineDraft.placeIds ?? []),
      lineDraft.placeIdA,
      lineDraft.placeIdB,
    ]);
    for (const quote of quotesFromEvidence(lineDraft.evidence)) {
      const citation = registry.add(quote);
      if (citation) evidence.push(citation.id);
      else {
        addWarning(
          warning(
            "INVALID_CITATION",
            "对峙线的证据无法在原文中逐字找到，已丢弃该引用。",
            "warning",
            [a.id, b.id],
          ),
        );
      }
    }
    if (evidence.length === 0) {
      dropped.frontLines += 1;
      addWarning(
        warning(
          "EVIDENCE_MISSING",
          "对峙线缺少可验证证据，已丢弃。",
          "warning",
          [a.id, b.id],
        ),
      );
      continue;
    }

    const frontLine: FrontLine = {
      id: `fl${frontLines.length + 1}`,
      factionIds: factionIds.slice(0, 4),
      geometry: {
        type: "LineString",
        coordinates: derivedStandoffLine(
          [
            (a.location!.lng + b.location!.lng) / 2,
            (a.location!.lat + b.location!.lat) / 2,
          ],
          [b.location!.lng, b.location!.lat],
        ),
      },
      schematic: true,
      evidence: dedupeStrings(evidence),
    };
    const name = sliceText(lineDraft.name, 200);
    if (name) frontLine.name = name;
    frontLines.push(frontLine);
    frontLineByRef.set(frontLine.id, frontLine);
    const rawId = normalizeIdRef(lineDraft.id);
    if (rawId) frontLineByRef.set(rawId, frontLine);
  }

  /* ------------------------------------------------------------------ */
  /* Route sanity: do not start/end at a place introduced later.          */
  /* ------------------------------------------------------------------ */

  const citationStarts = new Map(
    registry.all().map((citation) => [citation.id, citation.start]),
  );
  const citationEnds = new Map(
    registry.all().map((citation) => [citation.id, citation.end]),
  );
  const placeFirstStart = (place: Place | undefined): number | undefined => {
    if (!place) return undefined;
    let first: number | undefined;
    for (const id of place.evidence) {
      const start = citationStart(id, citationStarts);
      if (start !== undefined && (first === undefined || start < first)) {
        first = start;
      }
    }
    return first;
  };
  const dropRoute = (route: Route): void => {
    const index = routes.indexOf(route);
    if (index >= 0) routes.splice(index, 1);
    for (const [key, value] of routeByRef) {
      if (value === route) routeByRef.delete(key);
    }
  };

  for (let index = routes.length - 1; index >= 0; index -= 1) {
    const route = routes[index]!;
    const starts = route.evidence
      .map((id) => citationStart(id, citationStarts))
      .filter((value): value is number => value !== undefined);
    const ends = route.evidence
      .map((id) => citationStart(id, citationEnds))
      .filter((value): value is number => value !== undefined);
    if (starts.length === 0) continue;
    const routeStart = Math.min(...starts);
    const routeEnd = Math.max(...ends);
    const from = placeById.get(route.fromPlaceId);
    const to = placeById.get(route.toPlaceId);
    const fromStart = placeFirstStart(from);
    const toStart = placeFirstStart(to);
    // Restrict this chronology repair to pursuit labels. Other routes may
    // legitimately span windows/places and should not be rewritten by a
    // heuristic that cannot see the full chapter context.
    const pursuit = /追|追击|追到/.test(route.label ?? "");

    if (
      pursuit &&
      from &&
      fromStart !== undefined &&
      fromStart > routeEnd + 200
    ) {
      const candidates = places
        .filter(
          (place) =>
            place.location &&
            place.id !== from.id &&
            place.id !== to?.id &&
            (!route.factionId || place.factionId === route.factionId),
        )
        .map((place) => ({ place, start: placeFirstStart(place) }))
        .filter(
          (entry): entry is { place: Place; start: number } =>
            entry.start !== undefined && entry.start <= routeStart,
        )
        .sort((a, b) => b.start - a.start);
      const replacement = candidates[0]?.place;
      if (replacement) {
        route.fromPlaceId = replacement.id;
        addWarning(
          warning(
            "ROUTE_ENDPOINT_REPAIRED",
            `路线“${route.label ?? route.id}”的起点“${from.name}”在后文才出现，已改为同一势力在前的“${replacement.name}”。`,
            "info",
            [route.id, from.id, replacement.id],
          ),
        );
      } else {
        dropRoute(route);
        addWarning(
          warning(
            "ROUTE_ENDPOINT_FUTURE",
            `路线“${route.label ?? route.id}”的起点“${from.name}”在后文才出现，已丢弃以免画出错误行军线。`,
            "warning",
            [route.id, from.id],
          ),
        );
      }
    }

    if (pursuit && to && toStart !== undefined && toStart > routeEnd + 200) {
      const candidates = places
        .filter(
          (place) =>
            place.location &&
            place.id !== to.id &&
            place.id !== from?.id &&
            (!route.factionId || place.factionId === route.factionId),
        )
        .map((place) => ({ place, start: placeFirstStart(place) }))
        .filter(
          (entry): entry is { place: Place; start: number } =>
            entry.start !== undefined && entry.start <= routeStart,
        )
        .sort((a, b) => b.start - a.start);
      const replacement = candidates[0]?.place;
      if (replacement) {
        route.toPlaceId = replacement.id;
        addWarning(
          warning(
            "ROUTE_ENDPOINT_REPAIRED",
            `路线“${route.label ?? route.id}”的终点“${to.name}”在后文才出现，已改为同一势力在前的“${replacement.name}”。`,
            "info",
            [route.id, to.id, replacement.id],
          ),
        );
      } else {
        dropRoute(route);
        addWarning(
          warning(
            "ROUTE_ENDPOINT_FUTURE",
            `路线“${route.label ?? route.id}”的终点“${to.name}”在后文才出现，已丢弃以免画出错误行军线。`,
            "warning",
            [route.id, to.id],
          ),
        );
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Scenes                                                              */
  /* ------------------------------------------------------------------ */

  const scenePoints = (scene: Scene): LngLat[] => {
    const points: LngLat[] = [];
    for (const placeId of scene.placeIds) {
      const place = placeById.get(placeId);
      if (place?.location) points.push([place.location.lng, place.location.lat]);
    }
    for (const routeId of scene.routeIds) {
      const route = routeByRef.get(routeId);
      if (!route) continue;
      for (const placeId of [route.fromPlaceId, route.toPlaceId]) {
        const place = placeById.get(placeId);
        if (place?.location) points.push([place.location.lng, place.location.lat]);
      }
    }
    for (const areaId of scene.areaIds) {
      const area = areaByRef.get(areaId);
      if (area) {
        for (const ring of area.geometry.coordinates) {
          for (const position of ring) points.push([position[0], position[1]]);
        }
      }
    }
    for (const lineId of scene.frontLineIds) {
      const line = frontLineByRef.get(lineId);
      if (line) {
        for (const position of line.geometry.coordinates) {
          points.push([position[0], position[1]]);
        }
      }
    }
    return points;
  };

  const mapScenes = (drafts: ModelSituationDraft["scenes"]): Scene[] => {
    const result: Scene[] = [];
    for (const sceneDraft of drafts ?? []) {
      if (!sceneDraft) continue;
      const placeIds = dedupeStrings(
        (sceneDraft.placeIds ?? [])
          .map((ref) => resolvePlace(ref)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const routeIds = dedupeStrings(
        (sceneDraft.routeIds ?? [])
          .map((ref) => routeByRef.get(ref)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const areaIds = dedupeStrings(
        (sceneDraft.areaIds ?? [])
          .map((ref) => areaByRef.get(ref)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const frontLineIds = dedupeStrings(
        (sceneDraft.frontLineIds ?? [])
          .map((ref) => frontLineByRef.get(ref)?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const droppedRefs =
        (sceneDraft.placeIds ?? []).filter((ref) => !resolvePlace(ref)).length +
        (sceneDraft.routeIds ?? []).filter((ref) => !routeByRef.get(ref)).length +
        (sceneDraft.areaIds ?? []).filter((ref) => !areaByRef.get(ref)).length +
        (sceneDraft.frontLineIds ?? []).filter((ref) => !frontLineByRef.get(ref)).length;
      if (droppedRefs > 0) {
        addWarning(
          warning(
            "DANGLING_SCENE_REF",
            "场景引用了不存在或已被丢弃的要素，相关引用已移除。",
            "warning",
            [...placeIds, ...routeIds, ...areaIds, ...frontLineIds],
          ),
        );
      }

      const draftScene: Scene = {
        id: `s${result.length + 1}`,
        index: result.length,
        title: sceneDraft.title?.trim() || `场景 ${result.length + 1}`,
        summary:
          sceneDraft.summary?.trim() || summaryFallback.overview,
        placeIds,
        routeIds,
        areaIds,
        frontLineIds,
      };
      const timeLabel = sceneDraft.timeLabel?.trim();
      if (timeLabel) draftScene.timeLabel = timeLabel;
      const points = scenePoints(draftScene);
      const camera = cameraForPoints(
        points.length > 0
          ? points
          : places
              .filter((place) => place.location)
              .map((place) => [place.location!.lng, place.location!.lat] as LngLat),
      );
      if (camera) draftScene.camera = camera;
      result.push(draftScene);
    }
    return result;
  };

  let scenes = mapScenes(draft?.scenes);

  if (scenes.length === 0) {
    const fallbackScene: Scene = {
      id: "s1",
      index: 0,
      title: titleFallback,
      summary: summaryFallback.overview,
      placeIds: places.map((place) => place.id),
      routeIds: routes.map((route) => route.id),
      areaIds: controlAreas.map((area) => area.id),
      frontLineIds: frontLines.map((line) => line.id),
    };
    const points = scenePoints(fallbackScene);
    const camera = cameraForPoints(points);
    if (camera) fallbackScene.camera = camera;
    scenes = [fallbackScene];
  } else {
    scenes = scenes.map((scene, index) => ({
      ...scene,
      index,
      camera: scene.camera,
    }));
  }

  // Server-derived control areas must be visible in at least one scene; the
  // frontend filters every feature set by scene references.
  for (const [areaId, members] of areaMembers) {
    if (scenes.some((scene) => scene.areaIds.includes(areaId))) continue;
    const memberSet = new Set(members);
    const targets = scenes.filter((scene) =>
      scene.placeIds.some((placeId) => memberSet.has(placeId)),
    );
    for (const scene of targets.length > 0 ? targets : [scenes[0]!]) {
      if (!scene.areaIds.includes(areaId)) scene.areaIds.push(areaId);
    }
  }
  // A single "全篇概览" scene makes the approximate overview useful without
  // forcing the reader to click through every scene first.
  if (scenes.length > 1) {
    const overviewScene: Scene = {
      id: "s-overview",
      index: 0,
      title: "全篇概览",
      summary: summaryFallback.overview,
      placeIds: places.map((place) => place.id),
      routeIds: routes.map((route) => route.id),
      areaIds: controlAreas.map((area) => area.id),
      frontLineIds: frontLines.map((line) => line.id),
    };
    if (timeLabelFallback) overviewScene.timeLabel = timeLabelFallback;
    const overviewCamera = cameraForPoints(scenePoints(overviewScene));
    if (overviewCamera) overviewScene.camera = overviewCamera;
    scenes = [
      overviewScene,
      ...scenes.map((scene, index) => ({ ...scene, index: index + 1 })),
    ];
  }

  // Do not let an unrelated faction area (e.g. the western campaign) blow up
  // the camera of a one-place standoff scene. Keep an area only when at least
  // one of its member places is actually in this scene.
  for (const scene of scenes) {
    if (scene.placeIds.length === 0) continue;
    scene.areaIds = scene.areaIds.filter((areaId) => {
      const members = areaMembers.get(areaId);
      if (!members || members.length === 0) return true;
      return members.some((member) => scene.placeIds.includes(member));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Standoff sanity: "收兵修建营垒、据险自守、双方僵持" is a contact    */
  /* line, not a march. If the model spent the cue on a route or omitted  */
  /* the front line entirely, derive a short schematic standoff at the    */
  /* nearest located place and attach it to the relevant scenes.          */
  /* ------------------------------------------------------------------ */

  const allCitations = registry.all();
  const citationById = new Map(
    allCitations.map((citation) => [citation.id, citation]),
  );
  const placePoint = (place: Place): LngLat | null =>
    place.location ? [place.location.lng, place.location.lat] : null;
  const cueById = new Map<
    string,
    { id: string; quote: string; start: number; end: number; localStart?: number }
  >();
  for (const citation of allCitations) {
    if (STANDOFF_CUE_RE.test(citation.quote)) {
      cueById.set(citation.id, {
        id: citation.id,
        quote: citation.quote,
        start: citation.start,
        end: citation.end,
      });
    }
  }
  if (input.text) {
    const cuePattern = new RegExp(STANDOFF_CUE_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = cuePattern.exec(input.text))) {
      const localStart = match.index;
      const sentenceStart = Math.max(
        0,
        input.text.lastIndexOf("。", localStart) + 1,
        input.text.lastIndexOf("\n", localStart) + 1,
      );
      const nextBreak = input.text.indexOf("。", localStart);
      const sentenceEnd =
        nextBreak >= 0 ? Math.min(input.text.length, nextBreak + 1) : input.text.length;
      const quote = input.text.slice(sentenceStart, sentenceEnd).trim();
      if (!quote || !STANDOFF_STRONG_RE.test(quote)) continue;
      const citation = registry.add(quote);
      if (!citation) continue;
      cueById.set(citation.id, {
        id: citation.id,
        quote: citation.quote,
        start: citation.start,
        end: citation.end,
        localStart,
      });
    }
  }
  for (const cue of cueById.values()) {
    if (frontLines.some((line) => line.evidence.includes(cue.id))) continue;
    let nearestPlace: Place | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    if (input.text && cue.localStart !== undefined) {
      for (const place of places) {
        if (!place.location || !place.factionId) continue;
        let position = input.text.indexOf(place.name);
        if (position < 0) {
          position = input.text.indexOf(place.name.replace(/[縣阳陽]/g, ""));
        }
        if (position < 0 || position > cue.localStart) continue;
        const distance = cue.localStart - position;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPlace = place;
        }
      }
    }
    if (!nearestPlace) {
      for (const place of places) {
        if (!place.location || !place.factionId) continue;
        for (const evidenceId of place.evidence) {
          const citation = citationById.get(evidenceId);
          if (!citation) continue;
          const distance =
            citation.end <= cue.start
              ? cue.start - citation.end
              : citation.start <= cue.end
                ? 0
                : citation.start - cue.end;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPlace = place;
          }
        }
      }
    }
    if (!nearestPlace || nearestDistance > 600) continue;
    const anchor = placePoint(nearestPlace);
    if (!anchor) continue;

    // The nearest preceding movement route tells us which army is acting
    // ("李文忠追至称海"), even if the model assigned the destination place to
    // the opposing faction. Prefer that actor for the standoff.
    const actorRoute = routes
      .map((route) => {
        const start = Math.min(
          ...route.evidence
            .map((id) => citationStarts.get(id))
            .filter((value): value is number => value !== undefined),
        );
        const to = placeById.get(route.toPlaceId);
        const toPoint = to ? placePoint(to) : null;
        return {
          route,
          start: Number.isFinite(start) ? start : Number.POSITIVE_INFINITY,
          distance: toPoint ? distanceDegrees(anchor, toPoint) : Number.POSITIVE_INFINITY,
        };
      })
      .filter(
        (entry) =>
          entry.route.factionId &&
          entry.start <= cue.start &&
          entry.distance < 1500,
      )
      .sort((a, b) => b.start - a.start || a.distance - b.distance);
    const actingFactionId =
      actorRoute[0]?.route.factionId ?? nearestPlace.factionId;
    if (actingFactionId && actingFactionId !== nearestPlace.factionId) {
      nearestPlace.factionId = actingFactionId;
    }
    const enemies = places
      .filter(
        (place) =>
          place.location &&
          place.factionId &&
          place.factionId !== actingFactionId,
      )
      .map((place) => {
        let nearestCitationDistance = Number.POSITIVE_INFINITY;
        for (const evidenceId of place.evidence) {
          const citation = citationById.get(evidenceId);
          if (!citation) continue;
          const distance =
            citation.end <= cue.start
              ? cue.start - citation.end
              : citation.start <= cue.end
                ? 0
                : citation.start - cue.end;
          if (distance < nearestCitationDistance) {
            nearestCitationDistance = distance;
          }
        }
        return {
          place,
          evidenceDistance: nearestCitationDistance,
          distance: distanceDegrees(anchor, placePoint(place)!),
        };
      })
      .sort(
        (a, b) =>
          a.evidenceDistance - b.evidenceDistance || a.distance - b.distance,
      );
    const enemy = enemies[0]?.place;
    if (!enemy?.factionId) continue;
    const enemyPoint = placePoint(enemy);
    if (!enemyPoint) continue;

    // The model sometimes already placed a contact line at the same spot but
    // with the wrong factions / no name. Merge it instead of drawing a second
    // standoff line on top.
    const existingNearby = frontLines.find((line) =>
      line.geometry.coordinates.some(
        ([lng, lat]) =>
          distanceDegrees(anchor, [lng, lat]) < 0.6,
      ),
    );
    if (existingNearby) {
      existingNearby.name = existingNearby.name ?? `${nearestPlace.name}对峙`;
      existingNearby.evidence = dedupeStrings([
        ...existingNearby.evidence,
        cue.id,
        ...nearestPlace.evidence,
      ]);
      existingNearby.factionIds = [
        actingFactionId!,
        enemy.factionId,
      ].filter((id, index, all) => all.indexOf(id) === index);
      const targets = scenes.filter(
        (scene) =>
          scene.placeIds.includes(nearestPlace!.id) ||
          scene.placeIds.includes(enemy.id),
      );
      for (const scene of targets) {
        if (!scene.frontLineIds.includes(existingNearby.id)) {
          scene.frontLineIds.push(existingNearby.id);
        }
      }
      addWarning(
        warning(
          "STANDOFF_MERGED",
          `已在“${nearestPlace.name}”附近合并/修正模型给出的对峙线（${nearestPlace.name} / ${enemy.name}）。`,
          "info",
          [existingNearby.id, nearestPlace.id, enemy.id],
        ),
      );
      continue;
    }

    const frontLine: FrontLine = {
      id: `fl${frontLines.length + 1}`,
      name: `${nearestPlace.name}对峙`,
      factionIds: [actingFactionId!, enemy.factionId],
      geometry: {
        type: "LineString",
        coordinates: derivedStandoffLine(anchor, enemyPoint),
      },
      schematic: true,
      evidence: dedupeStrings([cue.id, ...nearestPlace.evidence]),
    };
    frontLines.push(frontLine);
    frontLineByRef.set(frontLine.id, frontLine);
    const role = nearestPlace.role
      ? `${nearestPlace.role}；据险自守/与敌对峙`
      : "据险自守/与敌对峙";
    nearestPlace.role = sliceText(role, 200);
    if (nearestPlace.category === "city" || nearestPlace.category === "region") {
      nearestPlace.category = "camp";
    }

    const targets = scenes.filter(
      (scene) =>
        scene.placeIds.includes(nearestPlace!.id) ||
        scene.placeIds.includes(enemy.id),
    );
    for (const scene of targets.length > 0 ? targets : [scenes[scenes.length - 1]!]) {
      if (!scene.frontLineIds.includes(frontLine.id)) {
        scene.frontLineIds.push(frontLine.id);
      }
    }
    addWarning(
      warning(
        "STANDOFF_DERIVED",
        `原文“${cue.quote.slice(0, 28)}…”是据守/对峙而非行军，已在“${nearestPlace.name}”附近补一条示意对峙线（${nearestPlace.name} / ${enemy.name}）。`,
        "info",
        [frontLine.id, nearestPlace.id, enemy.id],
      ),
    );
  }

  for (const scene of scenes) {
    const camera = cameraForPoints(scenePoints(scene));
    if (camera) scene.camera = camera;
  }
  for (const scene of scenes) {
    const camera = cameraForPoints(scenePoints(scene));
    if (camera) scene.camera = camera;
  }

  /* ------------------------------------------------------------------ */
  /* Summary + citations                                                 */
  /* ------------------------------------------------------------------ */

  const draftSummary = draft?.summary;
  const summary: Summary = {
    overview:
      draftSummary?.overview?.trim() ||
      summaryFallback.overview ||
      "未能生成态势摘要。",
    keyPoints: dedupeStrings(
      draftSummary?.keyPoints?.length
        ? draftSummary.keyPoints
        : summaryFallback.keyPoints,
    ).slice(0, 12),
    uncertainty: dedupeStrings(
      draftSummary?.uncertainty?.length
        ? draftSummary.uncertainty
        : summaryFallback.uncertainty,
    ).slice(0, 12),
  };

  const usedCitationIds = new Set<string>([
    ...places.flatMap((place) => place.evidence),
    ...routes.flatMap((route) => route.evidence),
    ...controlAreas.flatMap((area) => area.evidence),
    ...frontLines.flatMap((line) => line.evidence),
  ]);
  const citations = registry
    .all()
    .filter((citation) => usedCitationIds.has(citation.id));

  const situation: Situation = {
    title: draft?.title?.trim() || titleFallback,
    summary,
    factions,
    places,
    routes,
    controlAreas,
    frontLines,
    scenes,
    citations,
  };
  if (draft?.timeLabel?.trim()) situation.timeLabel = draft.timeLabel.trim();
  else if (timeLabelFallback?.trim()) situation.timeLabel = timeLabelFallback.trim();
  if (period) situation.period = period;

  return { situation, dropped };
}
