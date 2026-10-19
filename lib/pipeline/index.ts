import "server-only";

import { randomUUID } from "node:crypto";
import {
  MAX_CHAPTER_WINDOWS,
  MAX_SELECTION_CHARS,
  PROMPT_VERSION,
} from "@/lib/constants";
import {
  analysisSchema,
  situationSchema,
  type Analysis,
  type AnalysisInput,
  type AnalysisScope,
  type AnalysisStreamEvent,
  type Chapter,
  type Correction,
  type Period,
  type Situation,
  type Warning,
} from "@/lib/schema";
import { warning } from "@/lib/utils";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import { analysisCacheKey, sha256 } from "@/lib/server/hash";
import type { LlmConfig } from "@/lib/llm";
import { createQuoteIndex, locateQuote } from "./evidence";
import { defaultPipelineDeps } from "./deps";
import { mergeSegmentSituations } from "./merge";
import {
  analyzeModelSegment,
  inferPeriodWithModel,
} from "./model";
import { inferPeriodFromText } from "./period";
import { buildRuleSituation } from "./rule";
import type {
  AnalyzeOptions,
  AnalyzeSegment,
  PipelineDeps,
  ProviderPlan,
  StageName,
  UsageAccumulator,
} from "./types";
import { buildChapterWindows } from "./windows";

export type {
  AnalyzeOptions,
  PipelineDeps,
} from "./types";
export { buildChapterWindows } from "./windows";
export { mergeSegmentSituations } from "./merge";
export { analyzeModelSegment } from "./model";
export { buildRuleSituation } from "./rule";
export {
  citationIdFor,
  createCitationRegistry,
  createQuoteIndex,
  locateQuote,
  normalizeQuoteText,
  quotesFromEvidence,
} from "./evidence";
export { stripModelCoordinates, hasCoordinateFields } from "./sanitize";
export {
  bufferedControlPolygon,
  cameraForPoints,
  convexHull,
} from "./geometry";
export { inferPeriodFromText } from "./period";
export { parseModelMentions, parseModelSituationDraft } from "./model-draft";

function createWarningStore(initial: Warning[] = []): {
  warnings: Warning[];
  add: (value: Warning) => void;
} {
  const warnings = dedupeWarnings(initial);
  const seen = new Set(warnings.map(warningKey));
  return {
    warnings,
    add(value: Warning) {
      const key = warningKey(value);
      if (seen.has(key)) return;
      seen.add(key);
      if (warnings.length >= 80) return;
      warnings.push(value);
    },
  };
}

function warningKey(value: Warning): string {
  return `${value.code}|${value.message}|${(value.refs ?? []).join(",")}`;
}

export function dedupeWarnings(values: Warning[]): Warning[] {
  const seen = new Set<string>();
  const result: Warning[] = [];
  for (const value of values) {
    const key = warningKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= 80) break;
  }
  return result;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AppError(ERROR_CODES.ANALYSIS_ABORTED, "分析已取消。", {
      status: 499,
    });
  }
}

export function analysisErrorEvent(error: unknown): AnalysisStreamEvent {
  if (error instanceof AppError) {
    return {
      type: "error",
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    type: "error",
    code: ERROR_CODES.INTERNAL,
    message: "分析失败，请稍后重试。",
    retryable: false,
  };
}

function scopeLabel(scope: AnalysisScope): string {
  switch (scope) {
    case "page":
      return "页面";
    case "paragraph":
      return "段落";
    case "chapter":
      return "本章";
    case "selection":
    default:
      return "选段";
  }
}

interface Excerpt {
  start: number;
  end: number;
  text: string;
  warnings: Warning[];
}

function clampSelectionRange(
  chapter: Chapter,
  start: number,
  end: number,
): Excerpt {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "选段起止位置必须是整数。", {
      status: 400,
    });
  }
  if (start < 0 || end <= start || end > chapter.text.length) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      `选段范围不合法（${start}–${end}），章节长度为 ${chapter.text.length}。`,
      { status: 400 },
    );
  }
  let adjustedEnd = end;
  const warnings: Warning[] = [];
  if (end - start > MAX_SELECTION_CHARS) {
    adjustedEnd = start + MAX_SELECTION_CHARS;
    warnings.push(
      warning(
        "SELECTION_TRUNCATED",
        `选段超过 ${MAX_SELECTION_CHARS} 字，已截断到前 ${MAX_SELECTION_CHARS} 字进行分析。`,
        "info",
      ),
    );
  }
  return {
    start,
    end: adjustedEnd,
    text: chapter.text.slice(start, adjustedEnd),
    warnings,
  };
}

function resolveSelectionExcerpt(
  chapter: Chapter,
  input: AnalysisInput,
): Excerpt {
  if (input.start !== undefined && input.end !== undefined) {
    return clampSelectionRange(chapter, input.start, input.end);
  }
  if (input.start !== undefined || input.end !== undefined) {
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      "选段必须同时提供 start 与 end。",
      { status: 400 },
    );
  }
  const selectedText = input.selectedText?.trim();
  if (selectedText) {
    let start = chapter.text.indexOf(selectedText);
    let end = start + selectedText.length;
    if (start < 0) {
      const index = createQuoteIndex(chapter.text);
      const located = locateQuote(index, selectedText);
      if (located) {
        start = located.start;
        end = located.end;
      }
    }
    if (start < 0) {
      throw new AppError(
        ERROR_CODES.BAD_REQUEST,
        "选段文本无法在章节原文中找到。",
        { status: 400 },
      );
    }
    return clampSelectionRange(chapter, start, end);
  }
  throw new AppError(
    ERROR_CODES.BAD_REQUEST,
    "选段缺少起止位置或选中文本。",
    { status: 400 },
  );
}

function resolveDeps(options: AnalyzeOptions): PipelineDeps {
  return { ...defaultPipelineDeps, ...(options.deps ?? {}) };
}

function createProviderPlan(
  settings: Awaited<ReturnType<PipelineDeps["getEffectiveSettings"]>>,
  deps: PipelineDeps,
  options: AnalyzeOptions,
): ProviderPlan {
  const callFactory = (config: LlmConfig) =>
    options.clientFactory?.(config) ?? deps.createLlmClient(config);

  if (settings.provider === "rule") {
    return {
      mode: "rule",
      provider: "rule",
      model: "rule",
      settings,
    };
  }

  if (settings.provider === "mock") {
    const model = settings.model?.trim() || "mock";
    return {
      mode: "model",
      provider: "mock",
      model,
      settings,
      client: callFactory({
        provider: "mock",
        baseUrl: settings.baseUrl?.trim() || undefined,
        model,
        apiKey: settings.apiKey?.trim() || undefined,
      }),
    };
  }

  if (settings.provider === "openai" && !settings.apiKey?.trim()) {
    // No-key degradation is a product requirement. Record provider=rule so
    // results are never presented as model-generated.
    return {
      mode: "rule",
      provider: "rule",
      model: "rule",
      settings,
      fallbackFrom: "openai",
    };
  }

  const config: LlmConfig = {
    provider: settings.provider,
    baseUrl: settings.baseUrl?.trim() || undefined,
    model: settings.model?.trim() || undefined,
    apiKey: settings.apiKey?.trim() || undefined,
  };
  const client = callFactory(config);
  return {
    mode: "model",
    provider: settings.provider,
    model: config.model!.trim(),
    settings,
    client,
  };
}

function createSelectionSegment(
  chapter: Chapter,
  scope: AnalysisScope,
  excerpt: Excerpt,
): AnalyzeSegment {
  const label = scopeLabel(scope);
  return {
    chapter,
    scope,
    start: excerpt.start,
    end: excerpt.end,
    text: excerpt.text,
    label,
    titleHint: chapter.title,
  };
}

function createRuleSegment(
  chapter: Chapter,
  scope: AnalysisScope,
  excerpt: Excerpt,
  windowCount: number,
): AnalyzeSegment {
  return {
    chapter,
    scope,
    start: excerpt.start,
    end: excerpt.end,
    text: excerpt.text,
    label:
      windowCount > 1
        ? `本章（${windowCount} 个段落窗口）`
        : scopeLabel(scope),
    titleHint: chapter.title,
  };
}

function modelTitleHint(
  chapter: Chapter,
  windowCount: number,
  index: number,
): string {
  return windowCount > 1
    ? `${chapter.title} · 第 ${index + 1} 段`
    : chapter.title;
}

async function loadContext(
  deps: PipelineDeps,
): Promise<{ corrections: Correction[]; gazetteer: Awaited<ReturnType<PipelineDeps["loadGazetteer"]>> }> {
  const [corrections, gazetteer] = await Promise.all([
    deps.listCorrections(),
    deps.loadGazetteer(),
  ]);
  return { corrections, gazetteer };
}

interface RunContext {
  request: AnalysisInput;
  options: AnalyzeOptions;
  deps: PipelineDeps;
  plan: ProviderPlan;
  scope: AnalysisScope;
  chapter: Chapter;
  excerpt: Excerpt;
  segments: AnalyzeSegment[];
  analysisId: string;
  warnings: ReturnType<typeof createWarningStore>;
  usage: UsageAccumulator;
  emit: (event: AnalysisStreamEvent) => void;
  signal?: AbortSignal;
  corrections: Correction[];
  gazetteer: Awaited<ReturnType<PipelineDeps["loadGazetteer"]>>;
}

function emitStage(
  emit: (event: AnalysisStreamEvent) => void,
  stage: StageName,
  message: string,
  progress?: number,
): void {
  emit({ type: "stage", stage, message, progress });
}

async function inferPeriod(context: RunContext): Promise<Period | undefined> {
  if (context.plan.mode === "rule") {
    const period = inferPeriodFromText(
      context.excerpt.text,
      context.gazetteer.dynasties,
    );
    emitStage(
      context.emit,
      "period",
      period
        ? `规则模式：推断时期为 ${period.label}`
        : "规则模式：未能从文本中推断时期，将不做时期过滤。",
      0.1,
    );
    return period;
  }

  emitStage(context.emit, "period", "推断文本时期…", 0.08);
  const period = await inferPeriodWithModel({
    client: context.plan.client!,
    text: context.excerpt.text.slice(0, 6000),
    signal: context.signal,
    usage: context.usage,
    addWarning: context.warnings.add,
  });
  emitStage(
    context.emit,
    "period",
    period
      ? `推断时期：${period.label}`
      : "时期未详，继续分析但不做时期过滤。",
    0.12,
  );
  return period;
}

function validateAndFinalizeSituation(
  context: RunContext,
  situation: Situation,
): Situation {
  let parsed: Situation;
  try {
    parsed = situationSchema.parse(situation);
  } catch {
    if (context.plan.mode === "model") {
      throw new AppError(
        ERROR_CODES.MODEL_BAD_JSON,
        "模型态势结果未通过结构校验，请重试或更换模型。",
        { status: 502, retryable: true },
      );
    }
    throw new AppError(ERROR_CODES.INTERNAL, "分析结果未通过结构校验。", {
      status: 500,
    });
  }

  const located = parsed.places.filter((place) => place.location).length;
  if (located < 2) {
    context.warnings.add(
      warning(
        "INSUFFICIENT_PLACES",
        `有效地点少于 2 个（共 ${located} 个），前端不会绘制地图，仅显示文字结论与待考提示。`,
        "warning",
        parsed.places.map((place) => place.id).slice(0, 20),
      ),
    );
  }
  return parsed;
}

async function runAnalysis(
  request: AnalysisInput,
  options: AnalyzeOptions,
  forcedScope: "selection" | "chapter",
): Promise<Analysis> {
  const deps = resolveDeps(options);
  const emit = options.emit ?? (() => undefined);
  const signal = options.signal;
  throwIfAborted(signal);

  const chapter = await deps.getChapter(request.bookId, request.chapterId);
  if (!chapter) {
    throw new AppError(ERROR_CODES.CHAPTER_NOT_FOUND, "章节不存在或已删除。", {
      status: 404,
    });
  }
  throwIfAborted(signal);

  const scope: AnalysisScope =
    forcedScope === "chapter" ? "chapter" : request.scope;
  let excerpt: Excerpt;
  let windows: ReturnType<typeof buildChapterWindows> | undefined;

  if (scope === "chapter") {
    windows = buildChapterWindows(chapter);
    if (windows.windows.length === 0) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, "章节没有可分析的文本。", {
        status: 400,
      });
    }
    const first = windows.windows[0]!;
    const last = windows.windows[windows.windows.length - 1]!;
    excerpt = {
      start: first.start,
      end: last.end,
      text: chapter.text.slice(first.start, last.end),
      warnings: windows.truncated
        ? [
            warning(
              "CHAPTER_TRUNCATED",
              `章节超过 ${MAX_CHAPTER_WINDOWS} 段分析上限，仅分析前 ${MAX_CHAPTER_WINDOWS} 段。`,
              "warning",
            ),
          ]
        : [],
    };
  } else {
    excerpt = resolveSelectionExcerpt(chapter, request);
  }

  const settings = await deps.getEffectiveSettings();
  const plan = createProviderPlan(settings, deps, options);
  const baseWarnings = [...excerpt.warnings];
  if (plan.fallbackFrom === "openai") {
    baseWarnings.push(
      warning(
        "NO_API_KEY",
        "未配置模型 API Key，已使用规则模式：仅标注可识别地名，不生成势力、路线与战局。",
        "info",
      ),
    );
  }
  const warnings = createWarningStore(baseWarnings);

  const cacheKey = analysisCacheKey({
    bookId: request.bookId,
    chapterId: request.chapterId,
    text: excerpt.text,
    scope,
    promptVersion: PROMPT_VERSION,
    provider: plan.provider,
    model: plan.model,
  });

  throwIfAborted(signal);
  emitStage(emit, "cache", "检查分析缓存…", 0.02);
  const cached = await deps.getCachedAnalysis(cacheKey);
  if (cached) {
    const cachedAnalysis = analysisSchema.parse({
      ...cached,
      meta: {
        ...cached.meta,
        cacheHit: true,
        warnings: dedupeWarnings([...cached.meta.warnings, ...warnings.warnings]),
      },
    });
    emitStage(emit, "cache", "命中缓存，直接返回结果。", 0.05);
    emit({ type: "result", analysis: cachedAnalysis });
    emitStage(emit, "done", "分析完成（缓存命中）。", 1);
    return cachedAnalysis;
  }
  emitStage(emit, "cache", "未命中缓存，开始分析。", 0.05);

  const { corrections, gazetteer } = await loadContext(deps);
  const usage: UsageAccumulator = { input: 0, output: 0 };
  const analysisId = randomUUID();

  const context: RunContext = {
    request,
    options,
    deps,
    plan,
    scope,
    chapter,
    excerpt,
    segments: [],
    analysisId,
    warnings,
    usage,
    emit,
    signal,
    corrections,
    gazetteer,
  };

  throwIfAborted(signal);
  const period = await inferPeriod(context);

  let situation: Situation;
  if (plan.mode === "rule") {
    const segment =
      scope === "chapter"
        ? createRuleSegment(
            chapter,
            scope,
            excerpt,
            windows?.windows.length ?? 1,
          )
        : createSelectionSegment(chapter, scope, excerpt);
    context.segments = [segment];
    emitStage(emit, "places", "规则模式：扫描地名库…", 0.3);
    const ruleResult = await buildRuleSituation({
      segment,
      chapter,
      bookId: request.bookId,
      gazetteer,
      corrections,
      period,
      addWarning: warnings.add,
    });
    throwIfAborted(signal);
    emitStage(
      emit,
      "resolve",
      `规则模式：识别到 ${ruleResult.situation.places.length} 个地名，${
        ruleResult.situation.places.filter((place) => place.location).length
      } 个可定位。`,
      0.55,
    );
    emitStage(emit, "situation", "规则模式：生成文字结论与地名标注。", 0.75);
    situation = ruleResult.situation;
    emit({
      type: "partial",
      analysisId,
      sceneCount: situation.scenes.length,
    });
  } else {
    context.segments =
      scope === "chapter" && windows
        ? windows.windows.map((window) => ({
            chapter,
            scope,
            start: window.start,
            end: window.end,
            text: window.text,
            label: `第 ${window.index + 1}/${windows.windows.length} 段`,
            titleHint: modelTitleHint(chapter, windows.windows.length, window.index),
          }))
        : [createSelectionSegment(chapter, scope, excerpt)];

    const situations: Situation[] = [];
    for (const [index, segment] of context.segments.entries()) {
      throwIfAborted(signal);
      const segmentSituation = await analyzeModelSegment({
        client: plan.client!,
        segment,
        period,
        gazetteer,
        corrections,
        bookId: request.bookId,
        signal,
        usage,
        addWarning: warnings.add,
        emitStage: (stage, message) =>
          emitStage(
            emit,
            stage,
            message,
            0.15 + 0.6 * ((index + 1) / context.segments.length),
          ),
      });
      situations.push(segmentSituation);
      emit({
        type: "partial",
        analysisId,
        sceneCount: situations.reduce(
          (total, item) => total + item.scenes.length,
          0,
        ),
      });
    }

    throwIfAborted(signal);
    if (situations.length === 1) {
      situation = situations[0]!;
    } else {
      emitStage(emit, "situation", "合并章节窗口的态势结果…", 0.8);
      situation = mergeSegmentSituations(situations, {
        titleFallback: chapter.title,
        summaryFallback: {
          overview: `模型对本章 ${situations.length} 段分别分析后合并的态势结果。`,
          keyPoints: [],
          uncertainty: [],
        },
        timeLabelFallback: period?.label,
        period,
      });
    }
  }

  throwIfAborted(signal);
  emitStage(
    emit,
    "validate",
    "校验证据、引用与坐标来源…",
    0.9,
  );
  situation = validateAndFinalizeSituation(context, situation);

  const located = situation.places.filter((place) => place.location).length;
  emitStage(
    emit,
    "validate",
    `校验完成：${situation.places.length} 个地点（${located} 个已定位）、${situation.citations.length} 条引文。`,
    0.93,
  );

  const analysis: Analysis = {
    id: analysisId,
    bookId: request.bookId,
    chapterId: request.chapterId,
    scope,
    excerpt: {
      start: excerpt.start,
      end: excerpt.end,
      textHash: sha256(excerpt.text),
    },
    meta: {
      provider: plan.provider,
      model: plan.model,
      promptVersion: PROMPT_VERSION,
      createdAt: new Date().toISOString(),
      cacheHit: false,
      warnings: warnings.warnings,
      ...(usage.input > 0 || usage.output > 0
        ? { usage: { input: usage.input, output: usage.output } }
        : {}),
    },
    situation,
  };

  let parsedAnalysis: Analysis;
  try {
    parsedAnalysis = analysisSchema.parse(analysis);
  } catch {
    throw new AppError(ERROR_CODES.INTERNAL, "分析结果未通过契约校验。", {
      status: 500,
    });
  }

  throwIfAborted(signal);
  emitStage(emit, "persist", "保存分析结果…", 0.96);
  await deps.saveAnalysis(parsedAnalysis);
  try {
    await deps.setCachedAnalysis(cacheKey, parsedAnalysis);
  } catch {
    // A cache write failure must not fail an otherwise complete analysis.
    console.warn("[pipeline] cache write failed; analysis was saved normally.");
  }

  emit({ type: "result", analysis: parsedAnalysis });
  emitStage(emit, "done", "分析完成。", 1);
  return parsedAnalysis;
}

/** Analyze a selection/page/paragraph. Chapter scope is delegated. */
export async function analyzeSelection(
  input: AnalysisInput,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  if (input.scope === "chapter") return analyzeChapter(input, options);
  return runAnalysis(input, options, "selection");
}

/** Analyze a whole chapter with paragraph windows (max 12 windows). */
export async function analyzeChapter(
  input: AnalysisInput,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  return runAnalysis({ ...input, scope: "chapter" }, options, "chapter");
}

/** Scope-based dispatcher used by API routes. */
export async function analyze(
  input: AnalysisInput,
  options: AnalyzeOptions = {},
): Promise<Analysis> {
  return input.scope === "chapter"
    ? analyzeChapter(input, options)
    : analyzeSelection(input, options);
}
