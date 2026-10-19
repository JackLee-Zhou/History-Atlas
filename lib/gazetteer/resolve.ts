import { PRECISION_RADIUS_KM } from "@/lib/constants";
import type {
  AncientPlace,
  Correction,
  Dynasty,
  ModernPlace,
  Period,
  PlaceCategory,
  PlaceLocation,
  Precision,
  Warning,
} from "@/lib/schema";
import { clamp, warning } from "@/lib/utils";
import { loadGazetteer } from "./loader";
import {
  extractModernHint,
  labelsCompatible,
  normalizeName,
} from "./normalize";
import type {
  MentionInput,
  ResolveMentionsInput,
  ResolvedCandidate,
  ResolvedPlace,
} from "./types";

type PeriodInput = Period | { label: string; startYear?: number; endYear?: number };

interface PeriodBounds {
  startYear?: number;
  endYear?: number;
  label?: string;
}

interface AncientMatch {
  place: AncientPlace;
  matchedBy: "exact" | "alias";
}

interface ModernMatch {
  place: ModernPlace;
  score: number;
  precision: Precision;
  confidence: number;
}

function boundsFromPeriod(
  period: PeriodInput | undefined,
  dynasties: Dynasty[],
): PeriodBounds | undefined {
  if (!period) return undefined;
  const bounds: PeriodBounds = {
    label: period.label,
    startYear: period.startYear,
    endYear: period.endYear,
  };
  if (bounds.startYear === undefined && bounds.endYear === undefined && bounds.label) {
    const dynasty = dynasties.find(
      (item) =>
        labelsCompatible(bounds.label, item.label) ||
        item.aliases.some((alias) => labelsCompatible(bounds.label, alias)),
    );
    if (dynasty) {
      if (dynasty.startYear !== undefined) bounds.startYear = dynasty.startYear;
      if (dynasty.endYear !== undefined) bounds.endYear = dynasty.endYear;
    }
  }
  return bounds;
}

/**
 * A place period with an empty `periods` list is treated as always matchable
 * (contract: "古地名 periods 为空则视为可匹配").
 */
function periodMatches(
  placePeriods: AncientPlace["periods"],
  period: PeriodBounds | undefined,
): boolean {
  if (!period) return true;
  if (!placePeriods || placePeriods.length === 0) return true;

  const inputHasRange =
    period.startYear !== undefined || period.endYear !== undefined;
  const inputStart = period.startYear ?? Number.NEGATIVE_INFINITY;
  const inputEnd = period.endYear ?? Number.POSITIVE_INFINITY;

  for (const placePeriod of placePeriods) {
    const placeHasRange =
      placePeriod.startYear !== undefined || placePeriod.endYear !== undefined;
    if (inputHasRange && placeHasRange) {
      const placeStart = placePeriod.startYear ?? Number.NEGATIVE_INFINITY;
      const placeEnd = placePeriod.endYear ?? Number.POSITIVE_INFINITY;
      if (inputStart <= placeEnd && placeStart <= inputEnd) return true;
      continue;
    }
    if (period.label && placePeriod.label) {
      if (labelsCompatible(period.label, placePeriod.label)) return true;
    }
  }
  return false;
}

function buildAncientIndex(
  ancient: AncientPlace[],
): Map<string, AncientMatch[]> {
  const index = new Map<string, AncientMatch[]>();
  const add = (key: string, match: AncientMatch): void => {
    const normalized = normalizeName(key);
    if (!normalized) return;
    const list = index.get(normalized);
    if (list) {
      if (!list.some((item) => item.place.id === match.place.id)) list.push(match);
    } else {
      index.set(normalized, [match]);
    }
  };
  for (const place of ancient) {
    add(place.name, { place, matchedBy: "exact" });
    for (const alias of place.aliases) {
      add(alias, { place, matchedBy: "alias" });
    }
  }
  return index;
}

function findAncientMatches(
  name: string,
  ancient: AncientPlace[],
  index: Map<string, AncientMatch[]>,
): AncientMatch[] {
  const normalized = normalizeName(name);
  if (!normalized) return [];

  const exact = index.get(normalized);
  if (exact && exact.length > 0) return exact;

  // Model output may add an administrative suffix ("江陵城", "赤壁市").
  // Only accept containment when the dictionary name is at least two chars
  // and is the longest such candidate.
  let bestLength = 0;
  const contained: AncientMatch[] = [];
  for (const place of ancient) {
    for (const alias of [place.name, ...place.aliases]) {
      const key = normalizeName(alias);
      if (key.length < 2) continue;
      if (!normalized.includes(key)) continue;
      if (key.length > bestLength) {
        bestLength = key.length;
        contained.length = 0;
      }
      if (key.length === bestLength) {
        if (!contained.some((item) => item.place.id === place.id)) {
          contained.push({
            place,
            matchedBy: key === normalizeName(place.name) ? "exact" : "alias",
          });
        }
      }
    }
  }
  return contained;
}

function findCorrection(
  name: string,
  corrections: Correction[],
  bookId: string | undefined,
  period: PeriodBounds | undefined,
): Correction | undefined {
  const target = normalizeName(name);
  if (!target) return undefined;
  const applicable = corrections.filter((correction) => {
    if (normalizeName(correction.ancientName) !== target) return false;
    if (bookId && correction.bookId && correction.bookId !== bookId) return false;
    return true;
  });
  if (applicable.length === 0) return undefined;

  const score = (correction: Correction): number => {
    let value = 0;
    if (bookId && correction.bookId === bookId) value += 10;
    else if (!correction.bookId) value += 1;
    if (period && correction.periodLabel) {
      value += labelsCompatible(period.label, correction.periodLabel) ? 5 : 0;
    }
    return value;
  };

  return applicable
    .slice()
    .sort(
      (a, b) =>
        score(b) - score(a) ||
        b.createdAt.localeCompare(a.createdAt),
    )[0];
}

function correctionLocation(correction: Correction): PlaceLocation {
  const precision = correction.precision;
  return {
    lat: correction.lat,
    lng: correction.lng,
    precision,
    confidence: 0.92,
    radiusKm: PRECISION_RADIUS_KM[precision],
    source: "user",
  };
}

function candidatesForPlaces(places: AncientPlace[]): ResolvedCandidate[] {
  return places.map((place) => ({
    label: `${place.name}（${place.modernName}）`,
    lat: place.lat,
    lng: place.lng,
    gazetteerId: place.id,
  }));
}

function precisionForModern(
  hintNormalized: string,
  matchedKey: string,
  placeNameKey: string,
): Precision {
  const suffixes: Array<[string, Precision]> = [
    ["镇", "county"],
    ["乡", "county"],
    ["区", "county"],
    ["县", "county"],
    ["市", "city"],
  ];
  const base = matchedKey.replace(/[市县区镇乡]$/, "");
  for (const [suffix, precision] of suffixes) {
    if (matchedKey.endsWith(suffix)) return precision;
    if (base.length >= 2 && hintNormalized.includes(`${base}${suffix}`)) {
      return precision;
    }
    if (placeNameKey && hintNormalized.includes(`${placeNameKey}${suffix}`)) {
      return precision;
    }
  }
  return "city";
}

interface ModernIndexEntry {
  place: ModernPlace;
  names: Array<{ display: string; key: string }>;
  nameKey: string;
  admin1Key?: string;
  admin2Key?: string;
}

const modernIndexCache = new WeakMap<ModernPlace[], ModernIndexEntry[]>();

function modernIndex(modern: ModernPlace[]): ModernIndexEntry[] {
  const cached = modernIndexCache.get(modern);
  if (cached) return cached;
  const entries = modern.map((place) => ({
    place,
    nameKey: normalizeName(place.name),
    names: [place.name, ...place.aliases]
      .map((name) => ({ display: name, key: normalizeName(name) }))
      .filter((item) => item.key.length >= 2),
    admin1Key: place.admin1 ? normalizeName(place.admin1) : undefined,
    admin2Key: place.admin2 ? normalizeName(place.admin2) : undefined,
  }));
  modernIndexCache.set(modern, entries);
  return entries;
}

const GENERIC_REGION_KEYS = new Set(
  [
    "河南", "河北", "山东", "山西", "陕西", "甘肃", "湖北", "湖南",
    "安徽", "江苏", "浙江", "江西", "福建", "广东", "广西", "四川",
    "云南", "贵州", "辽宁", "吉林", "黑龙江", "内蒙古", "新疆", "西藏",
    "青海", "宁夏", "海南", "台湾", "江南", "江东", "关中", "淮北",
    "淮南", "中原", "河北道", "河南道", "旧城", "新城", "老城", "古城",
    "故城", "旧县", "县城", "城关", "城区", "东城", "西城", "南城",
    "北城", "河东", "河西", "江北", "塞外", "塞北", "关内", "关外",
    "辽东", "辽西",
  ].map(normalizeName),
);

function isGenericRegionName(name: string): boolean {
  return GENERIC_REGION_KEYS.has(normalizeName(name));
}

function findModernMatches(
  hint: string,
  modern: ModernPlace[],
): ModernMatch[] {
  const hintNormalized = normalizeName(hint);
  if (!hintNormalized) return [];

  const matches: ModernMatch[] = [];
  for (const entry of modernIndex(modern)) {
    const { place, names, nameKey } = entry;
    // Never turn a province/region hint into a random village that happens to
    // share the name (e.g. "河南" in Heilongjiang). A generic region is not a
    // usable point location; unresolved is better than a wrong marker.
    if (isGenericRegionName(place.name)) continue;
    let bestScore = 0;
    let bestKey = "";
    for (const { display, key } of names) {
      if (hintNormalized.includes(key)) {
        // Prefer the most specific (rightmost) place in an address hint:
        // "山东省菏泽市定陶区" should match 定陶, not tie with 菏泽.
        const position = hintNormalized.lastIndexOf(key);
        const specificity =
          hintNormalized.length > 0 ? position / hintNormalized.length : 0;
        const score =
          (display === place.name ? 3 : 2) + Math.max(0, specificity) * 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestKey = key;
        }
        continue;
      }
      // "今湖北赤壁" should match a modern entry named "赤壁市".
      const base = key.replace(/[市县区镇乡]$/, "");
      if (base.length >= 2 && hintNormalized.includes(base)) {
        const score = 1.8;
        if (score > bestScore) {
          bestScore = score;
          bestKey = key;
        }
      }
    }

    if (bestScore > 0) {
      if (entry.admin2Key && hintNormalized.includes(entry.admin2Key)) {
        bestScore += 0.5;
      }
      if (entry.admin1Key && hintNormalized.includes(entry.admin1Key)) {
        bestScore += 0.25;
      }
      matches.push({
        place,
        score: bestScore,
        precision: precisionForModern(hintNormalized, bestKey, nameKey),
        confidence: 0.58,
      });
      continue;
    }

    // Last resort: the hint names an admin2 unit (e.g. a county) that is only
    // present in the modern entry's address. Keep county precision, lower
    // confidence, and let ties become unresolved.
    if (
      entry.admin2Key &&
      entry.admin2Key.length >= 2 &&
      hintNormalized.includes(entry.admin2Key)
    ) {
      matches.push({
        place,
        score: 1,
        precision: "county",
        confidence: 0.46,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function unresolvedPlace(
  mention: MentionInput,
  reason: string,
  candidates: ResolvedCandidate[],
  code: string,
): ResolvedPlace {
  return {
    name: mention.name.trim(),
    category: mention.category ?? "other",
    confidence: 0,
    source: "unresolved",
    matchedBy: "none",
    unresolved: { reason, candidates },
    mention,
    warnings: [
      warning(code, reason, "warning", []),
    ],
  };
}

function resolvedFromAncient(
  mention: MentionInput,
  match: AncientMatch,
): ResolvedPlace {
  const place = match.place;
  const precision = place.precision;
  const confidence = clamp(
    place.confidence * (match.matchedBy === "alias" ? 0.97 : 1),
    0,
    0.99,
  );
  return {
    name: place.name,
    category:
      place.category === "other" && mention.category
        ? mention.category
        : place.category,
    location: {
      lat: place.lat,
      lng: place.lng,
      precision,
      confidence,
      radiusKm: PRECISION_RADIUS_KM[precision],
      source: "gazetteer",
    },
    confidence,
    source: "gazetteer",
    precision,
    radiusKm: PRECISION_RADIUS_KM[precision],
    matchedBy: match.matchedBy,
    ancientPlaceId: place.id,
    modernName: place.modernName,
    mention,
    warnings: [],
  };
}

function resolveOne(
  mention: MentionInput,
  input: {
    ancient: AncientPlace[];
    ancientIndex: Map<string, AncientMatch[]>;
    modern: ModernPlace[];
    corrections: Correction[];
    bookId?: string;
    period: PeriodBounds | undefined;
    contextText?: string;
  },
): ResolvedPlace {
  const name = mention.name.trim();
  if (!name) {
    return unresolvedPlace(mention, "地名称为空，无法定位。", [], "PLACE_NOT_FOUND");
  }

  const correction = findCorrection(
    name,
    input.corrections,
    input.bookId,
    input.period,
  );
  if (correction) {
    const location = correctionLocation(correction);
    return {
      name: correction.ancientName.trim(),
      category: mention.category ?? "other",
      location,
      confidence: location.confidence,
      source: "user",
      precision: correction.precision,
      radiusKm: location.radiusKm,
      matchedBy: "correction",
      modernName: correction.modernName,
      mention,
      warnings: [],
    };
  }

  // Model-first geocoding. The model saw the book/chapter/era/context and
  // returned a modern address plus approximate coordinates; that is more
  // trustworthy than blindly matching an ancient or modern same-name place.
  if (mention.modelLocation) {
    const geo = mention.modelLocation;
    const precision = geo.precision ?? "city";
    const confidence = clamp(geo.confidence ?? 0.6, 0.3, 0.95);
    return {
      name,
      category: mention.category ?? "other",
      location: {
        lat: geo.lat,
        lng: geo.lng,
        precision,
        confidence,
        radiusKm: PRECISION_RADIUS_KM[precision],
        source: "model",
      },
      confidence,
      source: "model",
      precision,
      radiusKm: PRECISION_RADIUS_KM[precision],
      matchedBy: "model",
      modernName: geo.modernName,
      locationNote:
        geo.reason?.trim() ||
        "模型按书名、章节年代与上下文匹配的现代位置。",
      mention,
      warnings: [
        warning(
          "MODEL_GEOLOCATED_PLACE",
          `“${name}”由模型按上下文定位到${geo.modernName ?? "近似现代位置"}；坐标为模型近似值。`,
          "info",
          [],
        ),
      ],
    };
  }

  const allMatches = findAncientMatches(name, input.ancient, input.ancientIndex);
  const periodMatchesList = allMatches.filter((match) =>
    periodMatches(match.place.periods, input.period),
  );

  if (periodMatchesList.length === 1) {
    return resolvedFromAncient(mention, periodMatchesList[0]!);
  }

  if (periodMatchesList.length > 1) {
    const reason = `“${name}”存在 ${periodMatchesList.length} 个候选，需人工确认。`;
    return unresolvedPlace(
      mention,
      reason,
      candidatesForPlaces(periodMatchesList.map((match) => match.place)),
      "AMBIGUOUS_PLACE",
    );
  }

  if (allMatches.length > 0) {
    const unique = [
      ...new Map(allMatches.map((match) => [match.place.id, match])).values(),
    ];
    // For an approximate overview, a unique gazetteer hit is more useful than
    // dropping the place solely because its recorded periods do not overlap the
    // model's inferred period. Keep the location but lower the confidence and
    // record the mismatch; multiple candidates still go to "待考".
    if (unique.length === 1) {
      const resolved = resolvedFromAncient(mention, unique[0]!);
      const confidence = clamp(resolved.confidence * 0.65, 0.35, 0.6);
      const labels = [
        ...new Set(
          unique[0]!.place.periods.map((period) => period.label),
        ),
      ].slice(0, 3);
      const periodLabel = input.period?.label;
      const reason = periodLabel
        ? `“${name}”的地名库时期（${labels.join("、") || "未详"}）与推断时期（${periodLabel}）不完全匹配，按近似位置处理。`
        : `“${name}”的时期不完全匹配，按近似位置处理。`;
      return {
        ...resolved,
        confidence,
        location: resolved.location
          ? { ...resolved.location, confidence }
          : undefined,
        warnings: [warning("PERIOD_APPROXIMATE", reason, "info", [])],
      };
    }
    const labels = [
      ...new Set(
        allMatches.flatMap((match) =>
          match.place.periods.map((period) => period.label),
        ),
      ),
    ].slice(0, 3);
    const periodLabel = input.period?.label;
    const reason = periodLabel
      ? `“${name}”的时期（${labels.join("、") || "未详"}）与 ${periodLabel} 不匹配。`
      : `“${name}”与推断时期不匹配。`;
    return unresolvedPlace(mention, reason, [], "PERIOD_MISMATCH");
  }

  // Prefer a concrete "今…" phrase inside the model's reasoning over its
  // broader modernName: e.g. "秦末安阳…约今山东曹县一带" should geocode 曹县,
  // not the prefecture 菏泽; "秦盱台县即今江苏盱眙县" should geocode 盱眙.
  const reasonHint = extractModernHint(mention.locationReason);
  const modelHint = mention.modernName?.trim()
    ? `${mention.modernAdmin?.trim() ?? ""} ${mention.modernName.trim()}`.trim()
    : "";
  const hintCandidates = [
    reasonHint,
    modelHint,
    mention.modernHint?.trim(),
    extractModernHint(mention.context),
    extractModernHint(mention.quote),
    extractModernHint(input.contextText),
  ].filter(
    (candidate, index, all): candidate is string =>
      Boolean(candidate?.trim()) && all.indexOf(candidate) === index,
  );

  let hint = hintCandidates[0];
  let modernMatches: ModernMatch[] = [];
  for (const candidate of hintCandidates) {
    const matches = findModernMatches(candidate, input.modern);
    if (matches.length > 0) {
      hint = candidate;
      modernMatches = matches;
      break;
    }
  }

  if (hint) {
    if (modernMatches.length > 0) {
      const best = modernMatches[0]!;
      const tied = modernMatches.filter(
        (match) => Math.abs(match.score - best.score) < 0.1,
      );
      if (tied.length > 1) {
        return unresolvedPlace(
          mention,
          `“${name}”的今地提示命中多个现代地名，需人工确认。`,
          tied.map((match) => ({
            label: match.place.name,
            lat: match.place.lat,
            lng: match.place.lng,
            gazetteerId: match.place.id,
          })),
          "AMBIGUOUS_PLACE",
        );
      }
      const precision = best.precision;
      return {
        name,
        category: mention.category ?? "other",
        location: {
          lat: best.place.lat,
          lng: best.place.lng,
          precision,
          confidence: best.confidence,
          radiusKm: PRECISION_RADIUS_KM[precision],
          source: "modern",
        },
        confidence: best.confidence,
        source: "modern",
        precision,
        radiusKm: PRECISION_RADIUS_KM[precision],
        matchedBy: "modern",
        modernPlaceId: best.place.id,
        modernName: best.place.name,
        locationNote:
          mention.locationReason?.trim() ||
          (mention.modernName
            ? `模型按年代判断：${mention.modernName}`
            : mention.modernHint?.trim()
              ? `今地提示：${mention.modernHint.trim()}`
              : undefined),
        mention,
        warnings: [],
      };
    }
  }

  const reason = hint
    ? `“${name}”未在古代地名库中找到，今地提示“${hint}”也未匹配到现代地名。`
    : `“${name}”未在古代地名库中找到，原文也没有可用的“今…”位置提示。`;
  return unresolvedPlace(mention, reason, [], "PLACE_NOT_FOUND");
}

/**
 * Resolve extracted mentions to locations.
 *
 * Coordinates only come from the ancient gazetteer, the modern gazetteer
 * (via a "今…" hint), or a user correction. The model's own coordinates never
 * reach this function (the pipeline strips them before extraction).
 */
export async function resolveMentions(
  input: ResolveMentionsInput,
): Promise<ResolvedPlace[]> {
  const gazetteer = input.gazetteer ?? (await loadGazetteer());
  const ancient = gazetteer.ancient;
  const ancientIndex = buildAncientIndex(ancient);
  const period = boundsFromPeriod(input.period, gazetteer.dynasties);
  const corrections = input.corrections ?? [];

  return input.mentions.map((mention) =>
    resolveOne(mention, {
      ancient,
      ancientIndex,
      modern: gazetteer.modern,
      corrections,
      bookId: input.bookId,
      period,
      contextText: input.contextText,
    }),
  );
}

/** Exposed for tests and other server modules that reuse period filtering. */
export function placePeriodMatches(
  placePeriods: AncientPlace["periods"],
  period: PeriodInput | undefined,
  dynasties: Dynasty[] = [],
): boolean {
  return periodMatches(placePeriods, boundsFromPeriod(period, dynasties));
}

/** Exposed for tests: the resolved place category defaults to "other". */
export function categoryOrDefault(
  category: PlaceCategory | undefined,
): PlaceCategory {
  return category ?? "other";
}

export type { Warning };
