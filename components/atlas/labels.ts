import {
  PLACE_CATEGORY_LABELS,
  PRECISION_LABELS,
  ROUTE_KIND_LABELS,
} from "@/lib/constants";
import type {
  Citation,
  Faction,
  Place,
  PlaceLocation,
  Route,
} from "@/lib/schema";

export const LOCATION_SOURCE_LABELS: Record<PlaceLocation["source"], string> = {
  gazetteer: "地名库",
  modern: "现代地名匹配",
  model: "模型定位",
  user: "用户修正",
  demo: "演示数据",
};

export function factionName(
  factions: readonly Faction[],
  factionId: string | undefined,
): string {
  if (!factionId) return "未标记势力";
  return (
    factions.find((faction) => faction.id === factionId)?.name ?? "未标记势力"
  );
}

export function factionColor(
  factions: readonly Faction[],
  factionId: string | undefined,
): string {
  if (!factionId) return "#5b5346";
  return (
    factions.find((faction) => faction.id === factionId)?.color ?? "#5b5346"
  );
}

export function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function precisionLabel(place: Place): string {
  if (!place.location) return "未定位";
  return PRECISION_LABELS[place.location.precision];
}

export function locationSourceLabel(place: Place): string {
  if (!place.location) return "待考";
  return LOCATION_SOURCE_LABELS[place.location.source];
}

export function placeCategoryLabel(place: Place): string {
  return PLACE_CATEGORY_LABELS[place.category];
}

export function routeKindLabel(route: Route): string {
  return ROUTE_KIND_LABELS[route.kind];
}

export function routeTitle(
  route: Route,
  places: readonly Place[],
): string {
  if (route.label) return route.label;
  const from = places.find((place) => place.id === route.fromPlaceId);
  const to = places.find((place) => place.id === route.toPlaceId);
  if (from && to) return `${from.name} → ${to.name}`;
  return routeKindLabel(route);
}

export function citationRange(citation: Citation): string {
  return `原文第 ${citation.start}–${citation.end} 字`;
}
