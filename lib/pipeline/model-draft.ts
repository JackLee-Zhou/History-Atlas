import { placeCategorySchema } from "@/lib/schema";
import type {
  ModelControlAreaDraft,
  ModelFactionDraft,
  ModelFrontLineDraft,
  ModelPlaceDraft,
  ModelPlaceRoleDraft,
  ModelRouteDraft,
  ModelSceneDraft,
  ModelSituationDraft,
  ModelSummaryDraft,
} from "./types";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) result.push(item.trim());
  }
  return result;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function category(value: unknown): ModelPlaceDraft["category"] {
  const parsed = placeCategorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export interface ParsedMentions {
  mentions: ModelPlaceDraft[];
  sawMentionsArray: boolean;
}

export function parseModelMentions(payload: unknown): ParsedMentions {
  const record = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.mentions)
      ? record.mentions
      : undefined;
  if (!list) return { mentions: [], sawMentionsArray: false };

  const mentions: ModelPlaceDraft[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    if (!entry) continue;
    const name = asString(entry.name);
    if (!name) continue;
    mentions.push({
      name,
      quote: asString(entry.quote),
      context: asString(entry.context),
      modernHint: asString(entry.modernHint),
      modernName: asString(entry.modernName),
      modernAdmin: asString(entry.modernAdmin),
      locationReason: asString(entry.locationReason),
      locationConfidence:
        typeof entry.locationConfidence === "number" &&
        Number.isFinite(entry.locationConfidence)
          ? Math.max(0, Math.min(1, entry.locationConfidence))
          : undefined,
      category: category(entry.category),
    });
    if (mentions.length >= 100) break;
  }
  return { mentions, sawMentionsArray: true };
}

function parseSummary(value: unknown): ModelSummaryDraft | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    overview: asString(record.overview),
    keyPoints: asStringArray(record.keyPoints),
    uncertainty: asStringArray(record.uncertainty),
  };
}

function parseFactions(value: unknown): ModelFactionDraft[] {
  const factions: ModelFactionDraft[] = [];
  for (const entry of asRecordArray(value)) {
    const name = asString(entry.name);
    if (!name) continue;
    factions.push({
      id: asString(entry.id),
      name,
      color: asString(entry.color),
      note: asString(entry.note),
    });
  }
  return factions;
}

function parsePlaceRoles(value: unknown): ModelPlaceRoleDraft[] {
  const places: ModelPlaceRoleDraft[] = [];
  for (const entry of asRecordArray(value)) {
    const placeId = asString(entry.placeId);
    const name = asString(entry.name);
    if (!placeId && !name) continue;
    places.push({
      placeId,
      name,
      factionId: asString(entry.factionId),
      role: asString(entry.role),
      evidence: entry.evidence,
    });
  }
  return places;
}

function parseRoutes(value: unknown): ModelRouteDraft[] {
  const routes: ModelRouteDraft[] = [];
  for (const entry of asRecordArray(value)) {
    routes.push({
      id: asString(entry.id),
      factionId: asString(entry.factionId),
      fromPlaceId: asString(entry.fromPlaceId),
      toPlaceId: asString(entry.toPlaceId),
      kind: asString(entry.kind),
      label: asString(entry.label),
      evidence: entry.evidence,
    });
  }
  return routes;
}

function parseControlAreas(value: unknown): ModelControlAreaDraft[] {
  const areas: ModelControlAreaDraft[] = [];
  for (const entry of asRecordArray(value)) {
    areas.push({
      id: asString(entry.id),
      factionId: asString(entry.factionId),
      name: asString(entry.name),
      placeIds: asStringArray(entry.placeIds),
      evidence: entry.evidence,
    });
  }
  return areas;
}

function parseFrontLines(value: unknown): ModelFrontLineDraft[] {
  const lines: ModelFrontLineDraft[] = [];
  for (const entry of asRecordArray(value)) {
    lines.push({
      id: asString(entry.id),
      name: asString(entry.name),
      factionIds: asStringArray(entry.factionIds),
      placeIdA: asString(entry.placeIdA),
      placeIdB: asString(entry.placeIdB),
      betweenPlaceIds: asStringArray(entry.betweenPlaceIds),
      placeIds: asStringArray(entry.placeIds),
      evidence: entry.evidence,
    });
  }
  return lines;
}

function parseScenes(value: unknown): ModelSceneDraft[] {
  const scenes: ModelSceneDraft[] = [];
  for (const entry of asRecordArray(value)) {
    scenes.push({
      id: asString(entry.id),
      title: asString(entry.title),
      timeLabel: asString(entry.timeLabel),
      summary: asString(entry.summary),
      placeIds: asStringArray(entry.placeIds),
      routeIds: asStringArray(entry.routeIds),
      areaIds: asStringArray(entry.areaIds),
      frontLineIds: asStringArray(entry.frontLineIds),
    });
  }
  return scenes;
}

function parseEvidence(value: unknown): ModelSituationDraft["evidence"] {
  if (!Array.isArray(value)) return [];
  const result: NonNullable<ModelSituationDraft["evidence"]> = [];
  for (const item of value) {
    if (typeof item === "string") {
      const quote = asString(item);
      if (quote) result.push({ quote, refs: [] });
      continue;
    }
    const entry = asRecord(item);
    if (!entry) continue;
    const quote = asString(entry.quote);
    if (!quote) continue;
    result.push({
      quote,
      refs: [
        ...asStringArray(entry.refs),
        ...asStringArray(entry.placeIds),
        ...asStringArray(entry.routeIds),
        ...asStringArray(entry.areaIds),
        ...asStringArray(entry.frontLineIds),
        ...asStringArray(entry.targets),
      ],
    });
  }
  return result;
}

/**
 * Shape-tolerant parser for the situation draft. Zod validation happens after
 * deterministic post-processing; this step only protects against wildly
 * malformed field types.
 */
export function parseModelSituationDraft(
  payload: unknown,
): ModelSituationDraft | null {
  let record = asRecord(payload);
  if (!record) return null;
  const nested = asRecord(record.situation);
  if (nested && !record.title && !record.summary) record = nested;

  return {
    title: asString(record.title),
    timeLabel: asString(record.timeLabel),
    summary: parseSummary(record.summary),
    factions: parseFactions(record.factions),
    places: parsePlaceRoles(record.places),
    routes: parseRoutes(record.routes),
    controlAreas: parseControlAreas(record.controlAreas),
    frontLines: parseFrontLines(record.frontLines),
    scenes: parseScenes(record.scenes),
    evidence: parseEvidence(record.evidence),
  };
}

export interface ParsedGeocodes {
  locations: import("./types").ModelGeocodeDraft[];
  sawLocationsArray: boolean;
}

function precision(value: unknown): "site" | "county" | "city" | undefined {
  return value === "site" || value === "county" || value === "city"
    ? value
    : undefined;
}

export function parseModelGeocodes(payload: unknown): ParsedGeocodes {
  const record = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.locations)
      ? record.locations
      : undefined;
  if (!list) return { locations: [], sawLocationsArray: false };

  const locations: import("./types").ModelGeocodeDraft[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    if (!entry) continue;
    const name = asString(entry.name);
    if (!name) continue;
    const lat = typeof entry.lat === "number" ? entry.lat : undefined;
    const lng = typeof entry.lng === "number" ? entry.lng : undefined;
    locations.push({
      name,
      modernName: asString(entry.modernName),
      lat,
      lng,
      precision: precision(entry.precision),
      confidence:
        typeof entry.confidence === "number" &&
        Number.isFinite(entry.confidence)
          ? Math.max(0, Math.min(1, entry.confidence))
          : undefined,
      reason: asString(entry.reason),
    });
    if (locations.length >= 100) break;
  }
  return { locations, sawLocationsArray: true };
}
