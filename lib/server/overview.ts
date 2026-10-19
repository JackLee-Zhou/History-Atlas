import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { OVERVIEW_POWER_COLORS } from "@/lib/constants";
import { createLlmClient, parseJsonLoose } from "@/lib/llm";
import { jsonRepairPrompt } from "@/lib/prompts";
import { overviewSystemPrompt, overviewPrompt } from "@/lib/prompts/overview";
import {
  overviewDraftSchema,
  overviewSchema,
  type Overview,
  type OverviewController,
  type OverviewPower,
  type OverviewRegion,
  type OverviewInput,
} from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import {
  getCachedOverview,
  getEffectiveSettings,
  getLatestAnalysisForChapter,
  getStoredBook,
  setCachedOverview,
} from "@/lib/server/store";
import {
  findProvinceByModelName,
  getProvinceCatalog,
} from "./provinces";

const OVERVIEW_CONTEXT_CHARS = 7_000;
const OVERVIEW_CAVEAT =
  "AI 历史推演，采用现代省界示意，不是精确历史疆域；空白省份表示模型未作判断，不代表无主；重叠控制用 contested 表示。";

function periodRangeLabel(period: {
  startYear?: number;
  endYear?: number;
}): string | undefined {
  if (period.startYear === undefined && period.endYear === undefined) {
    return undefined;
  }
  if (
    period.startYear !== undefined &&
    period.endYear !== undefined &&
    period.startYear !== period.endYear
  ) {
    return `${period.startYear}—${period.endYear} 年`;
  }
  const year = period.startYear ?? period.endYear;
  return year === undefined ? undefined : `约 ${year} 年`;
}

function contextFromAnalysis(
  analysis: Awaited<ReturnType<typeof getLatestAnalysisForChapter>>,
): string | undefined {
  if (!analysis) return undefined;
  const pieces = [
    analysis.situation.summary.overview,
    analysis.situation.factions.length > 0
      ? `当前势力：${analysis.situation.factions.map((faction) => faction.name).join("、")}`
      : undefined,
    analysis.situation.places.length > 0
      ? `当前地点：${analysis.situation.places.map((place) => place.name).slice(0, 20).join("、")}`
      : undefined,
  ].filter((piece): piece is string => Boolean(piece?.trim()));
  return pieces.length > 0 ? pieces.join("\n") : undefined;
}

function safePowerId(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/[^\w-]/g, "-").slice(0, 60);
  return trimmed || fallback;
}

function clampConfidence(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0.5;
}

function normalizePowerKind(
  value: string | undefined,
): "dynasty" | "regime" | "army" | "coalition" | "foreign" | "other" {
  const key = (value ?? "").trim().toLowerCase();
  const aliases: Record<string, "dynasty" | "regime" | "army" | "coalition" | "foreign" | "other"> = {
    dynasty: "dynasty",
    empire: "dynasty",
    "王朝": "dynasty",
    "朝代": "dynasty",
    regime: "regime",
    state: "regime",
    kingdom: "regime",
    "政权": "regime",
    "势力": "regime",
    army: "army",
    military: "army",
    rebel: "army",
    rebellion: "army",
    warlord: "army",
    "军队": "army",
    "农民军": "army",
    "军阀": "army",
    coalition: "coalition",
    alliance: "coalition",
    "联盟": "coalition",
    foreign: "foreign",
    external: "foreign",
    "外部势力": "foreign",
  };
  return aliases[key] ?? "other";
}

function normalizeStatus(value: string): "core" | "contested" | "nominal" | "presence" {
  const key = value.trim().toLowerCase();
  if (key === "core" || key === "controlled" || key === "stable" || key === "稳健控制") return "core";
  if (key === "nominal" || key === "nominally" || key === "名义" || key === "归附") return "nominal";
  if (key === "presence" || key === "activity" || key === "active" || key === "raiding" || key === "活动" || key === "活动区") return "presence";
  return "contested";
}

function normalizeOverview(
  draft: z.infer<typeof overviewDraftSchema>,
  model: string,
  provinces: ReturnType<typeof getProvinceCatalog>,
): Overview {
  const powerById = new Map<string, OverviewPower>();
  const powerByName = new Map<string, OverviewPower>();

  const powers: OverviewPower[] = [];
  for (const [index, candidate] of draft.powers.entries()) {
    const name = candidate.name.trim();
    if (!name) continue;
    const id = safePowerId(candidate.id ?? "", `power-${index + 1}`);
    if (powerById.has(id)) continue;
    const color = OVERVIEW_POWER_COLORS[index % OVERVIEW_POWER_COLORS.length]!;
    const power: OverviewPower = {
      id,
      name,
      kind: normalizePowerKind(candidate.kind),
      color,
    };
    powerById.set(id, power);
    if (!powerByName.has(name)) powerByName.set(name, power);
    powers.push(power);
  }
  if (powers.length === 0) {
    throw new AppError(
      ERROR_CODES.MODEL_BAD_JSON,
      "模型没有给出可识别的势力，请重试。",
      { status: 502, retryable: true },
    );
  }

  const byProvince = new Map<string, OverviewRegion>();
  for (const candidate of draft.regions) {
    const province = findProvinceByModelName(candidate.province, provinces);
    if (!province) continue;
    const controllers: OverviewController[] = [];
    const seen = new Set<string>();
    for (const item of candidate.controllers) {
      const power =
        powerById.get(item.powerId) ??
        powerByName.get(item.powerId) ??
        powers.find((entry) => entry.name === item.powerId);
      if (!power || seen.has(power.id)) continue;
      seen.add(power.id);
      controllers.push({
        powerId: power.id,
        status: normalizeStatus(item.status),
        confidence: clampConfidence(item.confidence),
        note: item.note?.trim() || undefined,
      });
    }
    if (controllers.length === 0) continue;
    const existing = byProvince.get(province.name);
    if (existing) {
      for (const controller of controllers) {
        if (existing.controllers.length >= 4) break;
        if (
          existing.controllers.some(
            (entry) => entry.powerId === controller.powerId,
          )
        ) {
          continue;
        }
        existing.controllers.push(controller);
      }
    } else {
      byProvince.set(province.name, {
        province: province.name,
        controllers,
      });
    }
  }

  if (byProvince.size === 0) {
    throw new AppError(
      ERROR_CODES.MODEL_BAD_JSON,
      "模型没有返回可识别的省份，请检查模型输出后重试。",
      { status: 502, retryable: true },
    );
  }

  const caveats = [...draft.caveats.map((item) => item.trim()).filter(Boolean)];
  if (!caveats.some((item) => item.includes("推演"))) {
    caveats.unshift(OVERVIEW_CAVEAT);
  }

  return overviewSchema.parse({
    asOf: draft.asOf,
    powers,
    regions: [...byProvince.values()],
    summary: draft.summary.trim(),
    caveats,
    meta: {
      source: "model",
      model,
      generatedAt: new Date().toISOString(),
    },
  });
}

function cacheKey(input: OverviewInput, model: string, periodLabel?: string): string {
  return createHash("sha256")
    .update(
      [
        "overview-v2",
        input.bookId,
        input.chapterId,
        periodLabel ?? "",
        model,
      ].join("|"),
    )
    .digest("hex");
}

/**
 * Generate (or read from cache) a province-level overview for a chapter.
 * This intentionally does not create citations: it is an AI synthesis over
 * historical knowledge, separate from the source-text evidence contract.
 */
export async function generateOverview(input: OverviewInput): Promise<{
  overview: Overview;
  cached: boolean;
}> {
  const stored = await getStoredBook(input.bookId);
  const chapter = stored?.chapters.find((item) => item.id === input.chapterId);
  if (!stored || !chapter) {
    throw new AppError(
      ERROR_CODES.CHAPTER_NOT_FOUND,
      "章节不存在，无法生成天下大势。",
      { status: 404 },
    );
  }

  const analysis = await getLatestAnalysisForChapter(
    input.bookId,
    input.chapterId,
  );
  const period = analysis?.situation.period;
  const settings = await getEffectiveSettings();
  const model = settings.model?.trim() || settings.provider;
  const key = cacheKey(input, model, period?.label);
  const cached = input.refresh ? null : await getCachedOverview(key);
  if (cached) return { overview: cached, cached: true };

  if (settings.provider === "rule") {
    throw new AppError(
      ERROR_CODES.PROVIDER_NOT_CONFIGURED,
      "天下大势需要配置模型服务。当前是规则模式，请到设置页填写模型。",
      { status: 400 },
    );
  }

  const client = createLlmClient(settings);
  const provinces = getProvinceCatalog();
  const provinceNames = provinces.map((province) => province.name);
  const user = overviewPrompt.user({
    bookTitle: stored.book.title,
    chapterTitle: chapter.title,
    periodLabel: period?.label,
    periodRange: period ? periodRangeLabel(period) : undefined,
    context: contextFromAnalysis(analysis),
    excerpt: chapter.text.slice(0, OVERVIEW_CONTEXT_CHARS),
    provinceNames,
  });
  const system = overviewSystemPrompt(provinceNames);

  let raw = await client.complete({
    system,
    user,
    json: true,
    temperature: 0.2,
  });
  let parsed = parseJsonLoose(raw.raw);
  if (!parsed.ok) {
    const repaired = await client.complete({
      system: jsonRepairPrompt.system,
      user: jsonRepairPrompt.user({
        raw: raw.raw.slice(0, 12_000),
        error: parsed.error,
        expectation:
          '{"asOf":{"label":"...","confidence":0.5},"powers":[...],"regions":[...],"summary":"...","caveats":[...]}',
      }),
      json: true,
      temperature: 0,
    });
    raw = repaired;
    parsed = parseJsonLoose(raw.raw);
  }
  if (!parsed.ok) {
    throw new AppError(
      ERROR_CODES.MODEL_BAD_JSON,
      "天下大势返回的 JSON 无法解析，请重试或更换模型。",
      { status: 502, retryable: true },
    );
  }

  const draftResult = overviewDraftSchema.safeParse(parsed.value);
  if (!draftResult.success) {
    throw new AppError(
      ERROR_CODES.MODEL_BAD_JSON,
      "天下大势返回结构不完整，请重试或更换模型。",
      { status: 502, retryable: true },
    );
  }
  const overview = normalizeOverview(draftResult.data, model, provinces);
  await setCachedOverview(key, input.bookId, input.chapterId, overview);
  return { overview, cached: false };
}
