import type {
  Chapter,
  Correction,
  Period,
  Place,
  Situation,
  Summary,
  Warning,
} from "@/lib/schema";
import { warning } from "@/lib/utils";
import {
  extractModernHint,
  normalizeName,
  resolveMentions,
  scanGazetteer,
  type GazetteerData,
  type MentionInput,
  type ResolvedPlace,
} from "@/lib/gazetteer";
import {
  createCitationRegistry,
  createQuoteIndex,
} from "./evidence";
import { cameraForPoints, type LngLat } from "./geometry";
import type { AnalyzeSegment } from "./types";

export interface RuleAnalysisInput {
  segment: AnalyzeSegment;
  chapter: Chapter;
  bookId: string;
  gazetteer: GazetteerData;
  corrections: Correction[];
  period?: Period;
  addWarning: (value: Warning) => void;
}

function expandEvidenceQuote(text: string, start: number, end: number): string {
  const punctuation = /[。！？；\n]/;
  let left = Math.max(0, start - 16);
  while (left > 0 && !punctuation.test(text[left - 1] ?? "")) {
    left -= 1;
    if (start - left > 60) break;
  }
  let right = Math.min(text.length, end + 18);
  while (right < text.length && !punctuation.test(text[right] ?? "")) {
    right += 1;
    if (right - end > 60) break;
  }
  const snippet = text.slice(left, right).trim();
  if (snippet.length <= 120) return snippet;
  return text.slice(Math.max(0, start - 20), Math.min(text.length, end + 20)).trim();
}

function placeKey(resolved: ResolvedPlace): string {
  const location = resolved.location;
  if (location) {
    return `${normalizeName(resolved.name)}|${location.lat.toFixed(3)},${location.lng.toFixed(3)}`;
  }
  return `${normalizeName(resolved.name)}|unresolved`;
}

export function buildRuleSummary(label: string, places: Place[]): Summary {
  const located = places.filter((place) => place.location).length;
  const unresolved = places.filter((place) => !place.location);
  const overview = `规则模式：在${label}中识别到 ${places.length} 个候选地名，其中 ${located} 个可从地名库定位；规则模式仅标注可识别地名，不调用大模型，因此不推断势力、路线与战局。`;
  const keyPoints = places
    .slice(0, 12)
    .map((place) =>
      place.location
        ? `${place.name} → ${place.modernName ?? "已定位"}（${place.location.precision}）`
        : `${place.name}（待考）`,
    );
  const uncertainty = [
    "规则模式仅标注可识别地名，不生成势力、路线、控制区与对峙线；这些内容需要配置模型后生成。",
    ...unresolved
      .slice(0, 6)
      .map(
        (place) =>
          `“${place.name}”未能定位，需人工核对或在地图上点选修正。`,
      ),
  ];
  return { overview, keyPoints, uncertainty };
}

/**
 * Offline rule-mode analysis: dictionary recall + gazetteer resolution.
 * It always produces exactly one scene and never fabricates coordinates,
 * factions or routes; a text-only result is valid when fewer than two places
 * are located (the frontend decides whether to draw the map).
 */
export async function buildRuleSituation(
  input: RuleAnalysisInput,
): Promise<{ situation: Situation; citations: number }> {
  const { segment, gazetteer, corrections, period, addWarning, bookId } = input;
  const candidates = await scanGazetteer(segment.text, { gazetteer });

  const mentions: MentionInput[] = candidates.map((candidate) => {
    const contextStart = Math.max(0, candidate.offset - 24);
    const contextEnd = Math.min(segment.text.length, candidate.end + 24);
    const context = segment.text.slice(contextStart, contextEnd);
    const quote = expandEvidenceQuote(
      segment.text,
      candidate.offset,
      candidate.end,
    );
    return {
      name: candidate.name,
      quote,
      context,
      modernHint: extractModernHint(context),
      category: candidate.category,
    };
  });

  const resolved = await resolveMentions({
    mentions,
    period,
    corrections,
    bookId,
    gazetteer,
  });

  const quoteIndex = createQuoteIndex(segment.text, segment.start);
  const registry = createCitationRegistry(quoteIndex);

  const places: Place[] = [];
  const byKey = new Map<string, Place>();
  for (const item of resolved) {
    const evidenceId = item.mention.quote
      ? registry.add(item.mention.quote)?.id
      : undefined;
    if (!evidenceId) {
      addWarning(
        warning(
          "INVALID_CITATION",
          `地名“${item.name}”缺少可逐字核对的原文证据，已丢弃。`,
          "warning",
          [],
        ),
      );
      continue;
    }
    const key = placeKey(item);
    const existing = byKey.get(key);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, evidenceId])];
      continue;
    }
    const place: Place = {
      id: `p${places.length + 1}`,
      name: item.name,
      category: item.category,
      evidence: [evidenceId],
    };
    if (item.modernName) place.modernName = item.modernName;
    if (item.location) place.location = item.location;
    if (item.unresolved) place.unresolved = item.unresolved;
    places.push(place);
    byKey.set(key, place);
    for (const itemWarning of item.warnings) addWarning(itemWarning);
  }

  const summary = buildRuleSummary(segment.label, places);
  const locatedPoints: LngLat[] = places
    .filter((place) => place.location)
    .map((place) => [place.location!.lng, place.location!.lat] as LngLat);
  const camera = cameraForPoints(locatedPoints);

  const situation: Situation = {
    title: `${segment.titleHint}（规则模式）`,
    summary,
    factions: [],
    places,
    routes: [],
    controlAreas: [],
    frontLines: [],
    scenes: [
      {
        id: "s1",
        index: 0,
        title: "地名标注",
        summary: summary.overview,
        placeIds: places.map((place) => place.id),
        routeIds: [],
        areaIds: [],
        frontLineIds: [],
        ...(camera ? { camera } : {}),
      },
    ],
    citations: registry.all(),
  };
  if (period?.label) situation.timeLabel = period.label;
  if (period) situation.period = period;
  return { situation, citations: situation.citations.length };
}
