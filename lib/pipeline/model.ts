import { LLM_TEMPERATURE } from "@/lib/constants";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import type { LlmClient } from "@/lib/llm";
import {
  parseJsonLoose,
} from "@/lib/llm/json";
import type {
  Correction,
  Period,
  Situation,
  Summary,
  Warning,
} from "@/lib/schema";import { warning } from "@/lib/utils";
import {
  normalizeName,
  resolveMentions,
  type GazetteerData,
  type MentionInput,
  type ResolvedPlace,
} from "@/lib/gazetteer";
import {
  jsonRepairPrompt,
  geocodePrompt,
  locatePrompt,
  periodPrompt,
  placesPrompt,
  situationPrompt,
  type SituationPromptPlace,
} from "@/lib/prompts";
import { assembleSituation } from "./assemble";
import {
  createCitationRegistry,
  createQuoteIndex,
} from "./evidence";
import {
  parseModelGeocodes,
  parseModelMentions,
  parseModelSituationDraft,
} from "./model-draft";
import { stripModelCoordinates } from "./sanitize";
import type {
  AnalyzeSegment,
  EmitStage,
  ModelPlaceDraft,
  ModelSituationDraft,
  PlaceSeed,
  UsageAccumulator,
} from "./types";

function addUsage(target: UsageAccumulator, usage?: { input: number; output: number }): void {
  if (!usage) return;
  target.input += usage.input;
  target.output += usage.output;
}

export interface JsonStageArgs {
  client: LlmClient;
  system: string;
  user: string;
  expectation: string;
  signal?: AbortSignal;
  usage: UsageAccumulator;
  addWarning: (value: Warning) => void;
}

/**
 * One JSON-shaped model call. Direct parse, then brace slice, then exactly one
 * repair request; still invalid => MODEL_BAD_JSON.
 */
export async function completeJsonStage(
  args: JsonStageArgs,
): Promise<unknown> {
  const first = await args.client.complete({
    system: args.system,
    user: args.user,
    json: true,
    temperature: LLM_TEMPERATURE,
    signal: args.signal,
  });
  addUsage(args.usage, first.usage);

  const parsed = parseJsonLoose(first.raw);
  if (parsed.ok) return parsed.value;

  const repaired = await args.client.complete({
    system: jsonRepairPrompt.system,
    user: jsonRepairPrompt.user({
      raw: first.raw.slice(0, 12_000),
      error: parsed.error,
      expectation: args.expectation,
    }),
    json: true,
    temperature: 0,
    signal: args.signal,
  });
  addUsage(args.usage, repaired.usage);

  const repairedParsed = parseJsonLoose(repaired.raw);
  if (repairedParsed.ok) {
    args.addWarning(
      warning(
        "MODEL_JSON_REPAIRED",
        "模型首次输出不是合法 JSON，已自动修复一次并通过校验。",
        "info",
      ),
    );
    return repairedParsed.value;
  }

  throw new AppError(
    ERROR_CODES.MODEL_BAD_JSON,
    "模型返回的 JSON 无法解析（已尝试修复一次），请重试或更换模型。",
    { status: 502, retryable: true },
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Non-fatal period inference: a bad period should not kill the analysis. */
export async function inferPeriodWithModel(args: {
  client: LlmClient;
  text: string;
  signal?: AbortSignal;
  usage: UsageAccumulator;
  addWarning: (value: Warning) => void;
}): Promise<Period | undefined> {
  let payload: unknown;
  try {
    payload = await completeJsonStage({
      client: args.client,
      system: periodPrompt.system,
      user: periodPrompt.user({ text: args.text }),
      expectation:
        '{"label":"朝代或年号时期","startYear":184,"endYear":220,"confidence":0.6}',
      signal: args.signal,
      usage: args.usage,
      addWarning: args.addWarning,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === ERROR_CODES.MODEL_BAD_JSON) {
      args.addWarning(
        warning(
          "PERIOD_UNRECOGNIZED",
          "模型未能给出可解析的时期，将继续分析，但时期筛选不可用。",
          "warning",
        ),
      );
      return undefined;
    }
    throw error;
  }

  const record = asRecord(payload) ?? asRecord(asRecord(payload)?.period);
  if (!record) return undefined;
  const label =
    typeof record.label === "string" ? record.label.trim() : undefined;
  if (!label || label === "未详" || label === "未知") return undefined;

  const toYear = (value: unknown): number | undefined => {
    if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
    if (value < -3000 || value > 2100) return undefined;
    return value;
  };
  let startYear = toYear(record.startYear);
  let endYear = toYear(record.endYear);
  if (startYear !== undefined && endYear !== undefined && startYear > endYear) {
    [startYear, endYear] = [endYear, startYear];
  }
  const confidence =
    typeof record.confidence === "number" &&
    Number.isFinite(record.confidence) &&
    record.confidence >= 0 &&
    record.confidence <= 1
      ? record.confidence
      : 0.5;

  const period: Period = { label, confidence };
  if (startYear !== undefined) period.startYear = startYear;
  if (endYear !== undefined) period.endYear = endYear;
  return period;
}

export async function extractMentionsWithModel(args: {
  client: LlmClient;
  segment: AnalyzeSegment;
  periodLabel?: string;
  signal?: AbortSignal;
  usage: UsageAccumulator;
  addWarning: (value: Warning) => void;
}): Promise<ModelPlaceDraft[]> {
  const payload = await completeJsonStage({
    client: args.client,
    system: placesPrompt.system,
    user: placesPrompt.user({
      text: args.segment.text,
      periodLabel: args.periodLabel,
    }),
    expectation:
      '{"mentions":[{"name":"江陵","quote":"曹操自江陵东下","context":"...","modernHint":"今湖北荆州","category":"city"}]}',
    signal: args.signal,
    usage: args.usage,
    addWarning: args.addWarning,
  });

  const sanitized = stripModelCoordinates(payload);
  if (sanitized.stripped) {
    args.addWarning(
      warning(
        "COORDINATES_STRIPPED",
        "模型输出中包含坐标/几何字段，已全部剥离；地点只能由服务端地名库定位。",
        "warning",
      ),
    );
  }

  const parsed = parseModelMentions(sanitized.value);
  if (!parsed.sawMentionsArray) {
    args.addWarning(
      warning(
        "MODEL_MENTIONS_MISSING",
        "模型未返回 mentions 数组，本段没有抽取到地名。",
        "warning",
      ),
    );
    return [];
  }
  return parsed.mentions;
}

async function extractSituationDraft(args: {
  client: LlmClient;
  segment: AnalyzeSegment;
  periodLabel?: string;
  places: SituationPromptPlace[];
  signal?: AbortSignal;
  usage: UsageAccumulator;
  addWarning: (value: Warning) => void;
}): Promise<ModelSituationDraft> {
  const payload = await completeJsonStage({
    client: args.client,
    system: situationPrompt.system,
    user: situationPrompt.user({
      text: args.segment.text,
      periodLabel: args.periodLabel,
      places: args.places,
    }),
    expectation:
      '{"title":"...","summary":{"overview":"...","keyPoints":[],"uncertainty":[]},"factions":[],"places":[],"routes":[],"controlAreas":[],"frontLines":[],"scenes":[]}',
    signal: args.signal,
    usage: args.usage,
    addWarning: args.addWarning,
  });

  const sanitized = stripModelCoordinates(payload);
  if (sanitized.stripped) {
    args.addWarning(
      warning(
        "COORDINATES_STRIPPED",
        "模型态势输出中包含坐标/几何字段，已全部剥离；坐标只来自地名库。",
        "warning",
      ),
    );
  }

  const draft = parseModelSituationDraft(sanitized.value);
  if (!draft) {
    throw new AppError(
      ERROR_CODES.MODEL_BAD_JSON,
      "模型态势结果不是 JSON 对象，无法生成地图要素。",
      { status: 502, retryable: true },
    );
  }
  return draft;
}

interface LocateHint {
  modernHint: string;
  reason?: string;
  confidence?: number;
}

function parseLocateHints(payload: unknown): Map<string, LocateHint> {
  const hints = new Map<string, LocateHint>();
  if (typeof payload !== "object" || payload === null) return hints;
  const list = (payload as { locations?: unknown }).locations;
  if (!Array.isArray(list)) return hints;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const modernHint =
      typeof record.modernHint === "string" ? record.modernHint.trim() : "";
    if (!name || !modernHint) continue;
    const reason =
      typeof record.reason === "string" ? record.reason.trim() : undefined;
    const confidence =
      typeof record.confidence === "number" &&
      Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : undefined;
    hints.set(normalizeName(name), { modernHint, reason, confidence });
  }
  return hints;
}

function seedKey(item: ResolvedPlace): string {
  if (item.location) {
    return `${normalizeName(item.name)}|${item.location.lat.toFixed(3)},${item.location.lng.toFixed(3)}`;
  }
  return `${normalizeName(item.name)}|unresolved`;
}

function buildFallbackSummary(
  segment: AnalyzeSegment,
  seeds: PlaceSeed[],
): Summary {
  return {
    overview: `模型在${segment.label}中识别到 ${seeds.length} 个地点，其中 ${
      seeds.filter((seed) => seed.location).length
    } 个已由地名库定位。`,
    keyPoints: seeds.slice(0, 8).map((seed) => seed.name),
    uncertainty: [
      "模型输出经过服务端证据校验与坐标剥离；无法逐字核对的要素已被丢弃。",
    ],
  };
}

export interface AnalyzeModelSegmentArgs {
  client: LlmClient;
  segment: AnalyzeSegment;
  period?: Period;
  gazetteer: GazetteerData;
  corrections: Correction[];
  bookId: string;
  signal?: AbortSignal;
  usage: UsageAccumulator;
  addWarning: (value: Warning) => void;
  emitStage: EmitStage;
}

/** Analyze one selection/window in model mode. */
export async function analyzeModelSegment(
  args: AnalyzeModelSegmentArgs,
): Promise<Situation> {
  const {
    client,
    segment,
    period,
    gazetteer,
    corrections,
    bookId,
    signal,
    usage,
    addWarning,
  } = args;

  args.emitStage("places", `${segment.label}：抽取地名…`);
  const mentions = await extractMentionsWithModel({
    client,
    segment,
    periodLabel: period?.label,
    signal,
    usage,
    addWarning,
  });

  const quoteIndex = createQuoteIndex(segment.text, segment.start);
  const registry = createCitationRegistry(quoteIndex);
  const validMentions: MentionInput[] = [];
  const mentionEvidence: Array<string | null> = [];

  for (const mention of mentions) {
    const citation = mention.quote ? registry.add(mention.quote) : null;
    if (!citation) {
      addWarning(
        warning(
          "INVALID_CITATION",
          `模型给出的地名“${mention.name}”缺少可在原文中逐字找到的引文，已丢弃。`,
          "warning",
          [],
        ),
      );
      continue;
    }
    validMentions.push({
      name: mention.name,
      quote: mention.quote,
      context: mention.context,
      modernHint: mention.modernHint,
      modernName: mention.modernName,
      modernAdmin: mention.modernAdmin,
      locationReason: mention.locationReason,
      locationConfidence: mention.locationConfidence,
      category: mention.category,
    });
    mentionEvidence.push(citation.id);
  }

  // Stage 2c: model-first modern geocoding for all valid mentions. This is the
  // primary path; the gazetteer resolver below remains a fallback for mentions
  // the geocoder could not place.
  if (validMentions.length > 0 && !signal?.aborted) {
    args.emitStage("resolve", `${segment.label}：模型匹配现代位置…`);
    try {
      const geoPayload = await completeJsonStage({
        client,
        system: geocodePrompt.system,
        user: geocodePrompt.user({
          bookTitle: segment.titleHint,
          chapterTitle: segment.chapter.title,
          periodLabel: period?.label,
          text: segment.text,
          places: validMentions.map((mention) => ({
            name: mention.name,
            quote: mention.quote,
            context: mention.context,
            category: mention.category,
          })),
        }),
        expectation:
          '{"locations":[{"name":"瓜州","modernName":"甘肃省酒泉市瓜州县","lat":40.52,"lng":95.78,"precision":"county","confidence":0.85,"reason":"明初瓜州指今甘肃瓜州县，不是江西同名地名"}]}',
        signal,
        usage,
        addWarning,
      });
      const parsed = parseModelGeocodes(geoPayload);
      let attached = 0;
      for (const mention of validMentions) {
        const geo = parsed.locations.find(
          (item) => normalizeName(item.name) === normalizeName(mention.name),
        );
        if (!geo) continue;
        const lat = geo.lat;
        const lng = geo.lng;
        if (
          typeof lat !== "number" ||
          typeof lng !== "number" ||
          !Number.isFinite(lat) ||
          !Number.isFinite(lng) ||
          lat < 5 ||
          lat > 60 ||
          lng < 60 ||
          lng > 150 ||
          (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01)
        ) {
          continue;
        }
        mention.modelLocation = {
          lat,
          lng,
          precision: geo.precision,
          confidence: geo.confidence,
          modernName: geo.modernName,
          reason: geo.reason,
        };
        attached += 1;
      }
      if (attached > 0) {
        addWarning(
          warning(
            "MODEL_GEOLOCATED",
            `${attached} 个地点由模型按年代与上下文匹配现代位置（坐标为模型近似值）。`,
            "info",
            [],
          ),
        );
      } else {
        addWarning(
          warning(
            "MODEL_GEOLOCATION_EMPTY",
            "模型未返回可用的现代坐标，已退回地名库匹配。",
            "warning",
            [],
          ),
        );
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      addWarning(
        warning(
          "MODEL_GEOLOCATION_FAILED",
          "模型现代定位调用失败，已退回地名库匹配。",
          "warning",
          [],
        ),
      );
    }
  }

  const resolved = await resolveMentions({
    mentions: validMentions,
    period,
    corrections,
    bookId,
    gazetteer,
  });

  // Stage 2b: for the "approximate overview" use case, ask the model for modern
  // place names for mentions the gazetteer could not place. Coordinates still
  // come only from the gazetteer/modern database, never from the model.
  const unlocatedIndices = resolved
    .map((item, index) => (item.location ? -1 : index))
    .filter((index) => index >= 0);
  if (unlocatedIndices.length > 0 && !signal?.aborted) {
    try {
      const locatePayload = await completeJsonStage({
        client,
        system: locatePrompt.system,
        user: locatePrompt.user({
          text: segment.text,
          periodLabel: period?.label,
          places: unlocatedIndices.map((index) => ({
            name: validMentions[index]!.name,
            context: validMentions[index]!.context,
            quote: validMentions[index]!.quote,
          })),
        }),
        expectation:
          '{"locations":[{"name":"定陶","modernHint":"今山东菏泽市定陶区","confidence":0.8}]}',
        signal,
        usage,
        addWarning,
      });
      const hints = parseLocateHints(stripModelCoordinates(locatePayload).value);
      if (hints.size > 0) {
        const retryMentions = validMentions.map((mention, index) => {
          if (resolved[index]?.location) return mention;
          const hint = hints.get(normalizeName(mention.name));
          return hint
            ? {
                ...mention,
                modernHint: hint.modernHint,
                locationReason:
                  hint.reason ?? `模型补全今地：${hint.modernHint}`,
              }
            : mention;
        });
        const retried = await resolveMentions({
          mentions: retryMentions,
          period,
          corrections,
          bookId,
          gazetteer,
        });
        let promoted = 0;
        retried.forEach((item, index) => {
          if (!resolved[index]?.location && item.location) {
            resolved[index] = {
              ...item,
              locationNote:
                item.locationNote ??
                `模型补全今地：${item.modernName ?? "未详"}`,
              warnings: [
                ...item.warnings,
                warning(
                  "LOCATION_APPROXIMATED",
                  `“${item.name}”的地名库/原文未给出位置，已用模型的今地提示“${item.modernName ?? "约"}”粗定位。`,
                  "info",
                  [],
                ),
              ],
            };
            promoted += 1;
          }
        });
        if (promoted > 0) {
          addWarning(
            warning(
              "APPROXIMATE_OVERVIEW",
              `有 ${promoted} 个地点使用模型的今地提示做了粗定位；坐标仍来自现代地名库，仅供概览。`,
              "info",
              [],
            ),
          );
        }
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      addWarning(
        warning(
          "LOCATE_HINTS_FAILED",
          "为未定位地点补充今地的模型调用失败，已保留“待考”状态。",
          "warning",
          [],
        ),
      );
    }
  }

  const seeds: PlaceSeed[] = [];
  const seedByKey = new Map<string, PlaceSeed>();
  resolved.forEach((item, index) => {
    const evidenceId = mentionEvidence[index];
    if (!evidenceId) return;
    const key = seedKey(item);
    const existing = seedByKey.get(key);
    if (existing) {
      existing.evidence = [...new Set([...existing.evidence, evidenceId])];
      return;
    }
    const seed: PlaceSeed = {
      id: `p${seeds.length + 1}`,
      name: item.name,
      category: item.category,
      evidence: [evidenceId],
    };
    if (item.modernName) seed.modernName = item.modernName;
    if (item.locationNote) seed.locationNote = item.locationNote;
    if (item.location) seed.location = item.location;
    if (item.unresolved) seed.unresolved = item.unresolved;
    seeds.push(seed);
    seedByKey.set(key, seed);
    for (const itemWarning of item.warnings) addWarning(itemWarning);
  });

  const placePromptInfo: SituationPromptPlace[] = seeds.map((seed) => {
    const citation = seed.evidence
      .map((id) => registry.get(id))
      .find((entry) => Boolean(entry));
    return {
      id: seed.id,
      name: seed.name,
      category: seed.category,
      modernName: seed.modernName,
      located: Boolean(seed.location),
      // Keep prompts single-line and bounded; the citation locator normalizes
      // whitespace, so returning this quote still resolves to the original.
      evidenceQuote: citation?.quote
        .replace(/\s+/g, " ")
        .slice(0, 240),
    };
  });

  args.emitStage(
    "resolve",
    `${segment.label}：解析到 ${seeds.length} 个地点（${
      seeds.filter((seed) => seed.location).length
    } 个已定位）。`,
  );
  args.emitStage("situation", `${segment.label}：生成态势与场景…`);
  const draft = await extractSituationDraft({
    client,
    segment,
    periodLabel: period?.label,
    places: placePromptInfo,
    signal,
    usage,
    addWarning,
  });

  const assembled = assembleSituation({
    registry,
    text: segment.text,
    seeds,
    draft,
    titleFallback: segment.titleHint,
    summaryFallback: buildFallbackSummary(segment, seeds),
    timeLabelFallback: period?.label,
    period,
    addWarning,
  });

  return assembled.situation;
}
