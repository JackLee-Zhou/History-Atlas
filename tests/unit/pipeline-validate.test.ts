import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRECISION_RADIUS_KM } from "@/lib/constants";
import type {
  Analysis,
  AnalysisStreamEvent,
  Chapter,
} from "@/lib/schema";
import { analysisSchema } from "@/lib/schema";
import type { LlmClient, LlmCompleteArgs } from "@/lib/llm";
import type { GazetteerData } from "@/lib/gazetteer";
import {
  analyzeChapter,
  analyzeSelection,
  type PipelineDeps,
} from "@/lib/pipeline";
import { analysisCacheKey } from "@/lib/server/hash";
import { PROMPT_VERSION } from "@/lib/constants";
import { ERROR_CODES } from "@/lib/server/http";

const CHAPTER_TEXT = "建安十三年，曹操自江陵东下，遇于赤壁。";

const chapter: Chapter = {
  id: "ch-1",
  bookId: "book-1",
  title: "赤壁之战",
  text: CHAPTER_TEXT,
  paragraphs: [{ start: 0, text: CHAPTER_TEXT }],
  pages: [],
  needsOCR: false,
};

const gazetteer: GazetteerData = {
  ancient: [
    {
      id: "jiangling",
      name: "江陵",
      aliases: ["江陵城"],
      category: "city",
      periods: [{ label: "东汉末年", startYear: 184, endYear: 220 }],
      modernName: "湖北荆州",
      admin1: "湖北",
      lat: 30.35,
      lng: 112.19,
      precision: "city",
      confidence: 0.8,
      source: { label: "测试地名库" },
    },
    {
      id: "chibi",
      name: "赤壁",
      aliases: ["赤壁矶"],
      category: "battlefield",
      periods: [{ label: "东汉末年", startYear: 184, endYear: 220 }],
      modernName: "湖北赤壁市",
      admin1: "湖北",
      lat: 29.72,
      lng: 113.9,
      precision: "site",
      confidence: 0.75,
      source: { label: "测试地名库" },
    },
  ],
  modern: [],
  dynasties: [
    { label: "东汉", startYear: 25, endYear: 220, aliases: ["东汉末年"] },
  ],
};

const VALID_MENTIONS = JSON.stringify({
  mentions: [
    {
      name: "江陵",
      quote: "曹操自江陵东下",
      context: "曹操自江陵东下",
      modernHint: "今湖北荆州",
      category: "city",
      // Must be stripped: locations never come from the model.
      lat: 1.23,
      lng: 4.56,
    },
    {
      name: "赤壁",
      quote: "遇于赤壁",
      context: "遇于赤壁",
      modernHint: "今湖北赤壁市",
      category: "battlefield",
    },
  ],
});

const DEFAULT_SITUATION = JSON.stringify({
  title: "赤壁对峙",
  timeLabel: "建安十三年",
  summary: {
    overview: "曹操军由江陵东下，与孙刘联军在赤壁对峙。",
    keyPoints: ["江陵为曹军出发点"],
    uncertainty: ["双方兵力未详"],
  },
  factions: [
    { id: "f1", name: "曹操军", color: "#9b2c2c" },
    { id: "f2", name: "孙刘联军", color: "#2c5282" },
  ],
  places: [
    { placeId: "p1", factionId: "f1", role: "出发点" },
    { placeId: "p2", factionId: "f2", role: "迎击地" },
  ],
  routes: [
    {
      id: "r1",
      fromPlaceId: "p1",
      toPlaceId: "p2",
      factionId: "f1",
      kind: "advance",
      label: "顺江东下",
      evidence: [],
    },
    {
      id: "r2",
      fromPlaceId: "p1",
      toPlaceId: "p99",
      factionId: "f1",
      kind: "advance",
      label: "悬空路线",
      evidence: ["曹操自江陵东下"],
    },
    {
      id: "r3",
      fromPlaceId: "p1",
      toPlaceId: "p2",
      factionId: "f2",
      kind: "other",
      label: "无效引用",
      evidence: ["这句原文并不存在"],
    },
  ],
  controlAreas: [
    {
      id: "a1",
      factionId: "f1",
      name: "曹军控制区",
      placeIds: ["p1", "p2"],
      evidence: ["曹操自江陵东下"],
    },
  ],
  frontLines: [
    {
      id: "fl1",
      factionIds: ["f1", "f2"],
      betweenPlaceIds: ["p1", "p2"],
      evidence: ["遇于赤壁"],
    },
  ],
  scenes: [
    {
      id: "s1",
      title: "战前推进",
      summary: "曹军自江陵推进到赤壁。",
      placeIds: ["p1", "p2"],
      routeIds: ["r1", "r2", "r99"],
      areaIds: ["a1"],
      frontLineIds: ["fl1"],
    },
  ],
  evidence: [
    { quote: "曹操自江陵东下", refs: ["r1"] },
    { quote: "顶层假引文", refs: ["p1"] },
  ],
});

interface FakeClientOptions {
  places?: string;
  situation?: string;
  period?: string;
}

function makeFakeClient(options: FakeClientOptions = {}): {
  client: LlmClient;
  complete: ReturnType<typeof vi.fn>;
} {
  const complete = vi.fn(async (args: LlmCompleteArgs) => {
    if (args.system.includes("【任务：时期判定】")) {
      return {
        raw:
          options.period ??
          JSON.stringify({
            label: "东汉末年",
            startYear: 184,
            endYear: 220,
            confidence: 0.7,
          }),
        usage: { input: 10, output: 4 },
      };
    }
    if (args.system.includes("【任务：地名抽取】")) {
      return {
        raw: options.places ?? VALID_MENTIONS,
        usage: { input: 20, output: 8 },
      };
    }
    if (args.system.includes("【任务：态势分析】")) {
      return {
        raw: options.situation ?? DEFAULT_SITUATION,
        usage: { input: 30, output: 12 },
      };
    }
    if (args.system.includes("【任务：JSON 修复】")) {
      return { raw: "{}", usage: { input: 5, output: 2 } };
    }
    return { raw: "{}" };
  });

  const client: LlmClient = {
    name: "fake",
    model: "fake-1",
    complete,
    stream: vi.fn(async () => ({})),
    testConnection: vi.fn(async () => ({ latencyMs: 1 })),
  };
  return { client, complete };
}

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    getChapter: vi.fn(async () => chapter),
    listCorrections: vi.fn(async () => []),
    getCachedAnalysis: vi.fn(async () => null),
    setCachedAnalysis: vi.fn(async () => undefined),
    saveAnalysis: vi.fn(async () => undefined),
    getEffectiveSettings: vi.fn(async () => ({
      provider: "mock" as const,
      model: "fake-model",
      geocoder: "none" as const,
      autoAnalyze: false,
    })),
    loadGazetteer: vi.fn(async () => gazetteer),
    createLlmClient: vi.fn(() => {
      throw new Error("clientFactory should be used in tests");
    }),
    ...overrides,
  };
}

async function runModel(
  options: {
    fake?: FakeClientOptions;
    deps?: Partial<PipelineDeps>;
  } = {},
): Promise<{
  analysis: Analysis;
  complete: ReturnType<typeof vi.fn>;
  events: AnalysisStreamEvent[];
}> {
  const fake = makeFakeClient(options.fake);
  const events: AnalysisStreamEvent[] = [];
  const deps = makeDeps(options.deps);
  const analysis = await analyzeSelection(
    {
      bookId: "book-1",
      chapterId: "ch-1",
      scope: "selection",
      start: 0,
      end: CHAPTER_TEXT.length,
    },
    {
      deps,
      emit: (event) => events.push(event),
      clientFactory: () => fake.client,
    },
  );
  return { analysis, complete: fake.complete, events };
}

function makeCachedAnalysis(): Analysis {
  return analysisSchema.parse({
    id: "cached-analysis",
    bookId: "book-1",
    chapterId: "ch-1",
    scope: "selection",
    excerpt: { start: 0, end: CHAPTER_TEXT.length, textHash: "a".repeat(64) },
    meta: {
      provider: "mock",
      model: "fake-model",
      promptVersion: "p1",
      createdAt: "2026-01-01T00:00:00.000Z",
      cacheHit: false,
      warnings: [],
    },
    situation: {
      title: "缓存态势",
      summary: { overview: "这是缓存结果。", keyPoints: [], uncertainty: [] },
      factions: [],
      places: [
        {
          id: "p1",
          name: "江陵",
          category: "city",
          location: {
            lat: 30.35,
            lng: 112.19,
            precision: "city",
            confidence: 0.8,
            radiusKm: PRECISION_RADIUS_KM.city,
            source: "gazetteer",
          },
          evidence: ["c-6-13"],
        },
        {
          id: "p2",
          name: "赤壁",
          category: "battlefield",
          location: {
            lat: 29.72,
            lng: 113.9,
            precision: "site",
            confidence: 0.75,
            radiusKm: PRECISION_RADIUS_KM.site,
            source: "gazetteer",
          },
          evidence: ["c-14-18"],
        },
      ],
      routes: [],
      controlAreas: [],
      frontLines: [],
      scenes: [
        {
          id: "s1",
          index: 0,
          title: "缓存场景",
          summary: "缓存场景。",
          placeIds: ["p1", "p2"],
          routeIds: [],
          areaIds: [],
          frontLineIds: [],
        },
      ],
      citations: [
        { id: "c-6-13", quote: "曹操自江陵东下", start: 6, end: 13 },
        { id: "c-14-18", quote: "遇于赤壁", start: 14, end: 18 },
      ],
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("model-mode validation and post-processing", () => {
  it("strips model coordinates and keeps gazetteer locations", async () => {
    const { analysis } = await runModel();
    const jiangling = analysis.situation.places.find(
      (place) => place.name === "江陵",
    )!;
    expect(jiangling.location).toMatchObject({
      lat: 30.35,
      lng: 112.19,
      source: "gazetteer",
    });
    expect(
      analysis.meta.warnings.some((item) => item.code === "COORDINATES_STRIPPED"),
    ).toBe(true);
    expect(analysis.situation.places.every((place) => place.location)).toBe(true);
  });

  it("drops features with invalid quotes or dangling references and prunes scenes", async () => {
    const { analysis } = await runModel();

    expect(analysis.situation.routes).toHaveLength(1);
    expect(analysis.situation.routes[0]?.label).toBe("顺江东下");
    const routeLabels = analysis.situation.routes.map((route) => route.label);
    expect(routeLabels).not.toContain("悬空路线");
    expect(routeLabels).not.toContain("无效引用");

    expect(analysis.situation.controlAreas).toHaveLength(1);
    expect(analysis.situation.controlAreas[0]?.schematic).toBe(true);
    expect(analysis.situation.controlAreas[0]?.geometry.type).toBe("Polygon");
    expect(analysis.situation.frontLines).toHaveLength(1);
    expect(analysis.situation.frontLines[0]?.schematic).toBe(true);

    const scene = analysis.situation.scenes[0]!;
    expect(scene.routeIds).toEqual(["r1"]);
    expect(scene.placeIds).toHaveLength(2);
    expect(scene.camera).toBeDefined();

    const codes = analysis.meta.warnings.map((item) => item.code);
    expect(codes).toContain("DANGLING_ROUTE");
    expect(codes).toContain("INVALID_CITATION");
    expect(codes).toContain("DANGLING_SCENE_REF");

    for (const citation of analysis.situation.citations) {
      expect(CHAPTER_TEXT.slice(citation.start, citation.end)).toBe(
        citation.quote,
      );
    }
    expect(
      analysis.situation.citations.some(
        (citation) => citation.quote === "这句原文并不存在",
      ),
    ).toBe(false);

    expect(analysis.meta.provider).toBe("mock");
    expect(analysis.meta.model).toBe("fake-model");
    expect(analysis.meta.usage?.input).toBe(60);
    expect(analysis.meta.usage?.output).toBe(24);
    expect(analysisSchema.safeParse(analysis).success).toBe(true);
  });

  it("keeps a text-only result and warns when fewer than two places are located", async () => {
    const onlyOne = JSON.stringify({
      mentions: [
        {
          name: "江陵",
          quote: "曹操自江陵东下",
          context: "曹操自江陵东下",
          category: "city",
        },
      ],
    });
    const situation = JSON.stringify({
      title: "仅一处地名",
      summary: {
        overview: "只识别到江陵一处可定位地名。",
        keyPoints: [],
        uncertainty: ["定位不足"],
      },
      factions: [],
      places: [],
      routes: [],
      controlAreas: [],
      frontLines: [],
      scenes: [],
    });
    const { analysis } = await runModel({
      fake: { places: onlyOne, situation },
    });
    expect(analysis.situation.places).toHaveLength(1);
    expect(analysis.situation.scenes).toHaveLength(1);
    expect(
      analysis.meta.warnings.some((item) => item.code === "INSUFFICIENT_PLACES"),
    ).toBe(true);
    expect(analysis.situation.summary.overview.length).toBeGreaterThan(0);
  });

  it("returns cached analyses with cacheHit=true without calling the model or saving", async () => {
    const cached = makeCachedAnalysis();
    const getCachedAnalysis = vi.fn(async () => cached);
    const saveAnalysis = vi.fn(async () => undefined);
    const setCachedAnalysis = vi.fn(async () => undefined);
    const fake = makeFakeClient();

    const analysis = await analyzeSelection(
      {
        bookId: "book-1",
        chapterId: "ch-1",
        scope: "selection",
        start: 0,
        end: CHAPTER_TEXT.length,
      },
      {
        deps: makeDeps({
          getCachedAnalysis,
          saveAnalysis,
          setCachedAnalysis,
        }),
        clientFactory: () => fake.client,
      },
    );

    expect(analysis.id).toBe(cached.id);
    expect(analysis.meta.cacheHit).toBe(true);
    expect(fake.complete).not.toHaveBeenCalled();
    expect(saveAnalysis).not.toHaveBeenCalled();
    expect(setCachedAnalysis).not.toHaveBeenCalled();
    expect(getCachedAnalysis).toHaveBeenCalledWith(
      analysisCacheKey({
        bookId: "book-1",
        chapterId: "ch-1",
        text: CHAPTER_TEXT,
        scope: "selection",
        promptVersion: PROMPT_VERSION,
        provider: "mock",
        model: "fake-model",
      }),
    );
  });

  it("analyzes chapters in overlapping windows and merges the model situations", async () => {
    const filler = "军行山谷之间旌旗相望".repeat(98) + "。";
    const first = filler;
    const second = `江陵${filler}`;
    const third = `赤壁${filler}`;
    const text = `${first}${second}${third}`;
    const longChapter: Chapter = {
      id: "ch-long",
      bookId: "book-1",
      title: "长章",
      text,
      paragraphs: [
        { start: 0, text: first },
        { start: first.length, text: second },
        { start: first.length + second.length, text: third },
      ],
      pages: [],
      needsOCR: false,
    };

    const complete = vi.fn(async (args: LlmCompleteArgs) => {
      if (args.system.includes("【任务：时期判定】")) {
        return {
          raw: JSON.stringify({
            label: "东汉末年",
            startYear: 184,
            endYear: 220,
            confidence: 0.7,
          }),
        };
      }
      const startMarker = "<<<原文开始>>>";
      const endMarker = "<<<原文结束>>>";
      const from = args.user.indexOf(startMarker) + startMarker.length;
      const to = args.user.indexOf(endMarker);
      const source = args.user.slice(from, to);

      if (args.system.includes("【任务：地名抽取】")) {
        const mentions = ["江陵", "赤壁"]
          .filter((name) => source.includes(name))
          .map((name) => ({
            name,
            quote: name,
            context: name,
            modernHint: undefined,
            category: name === "江陵" ? "city" : "battlefield",
          }));
        return { raw: JSON.stringify({ mentions }) };
      }
      if (args.system.includes("【任务：态势分析】")) {
        const lines = args.user.split("\n");
        const parsed: Array<{
          id: string;
          name: string;
          quote?: string;
        }> = [];
        for (const line of lines) {
          const match = /^\s*-\s*(p\d+)\s+([^\s（(]+)/.exec(line);
          if (!match?.[1] || !match[2]) continue;
          const quote = /证据原文：「([^」]+)」/.exec(line);
          parsed.push({ id: match[1], name: match[2], quote: quote?.[1] });
        }
        const factions = [
          { id: "f1", name: "曹操军", color: "#9b2c2c" },
          ...(parsed.length > 1
            ? [{ id: "f2", name: "孙刘联军", color: "#2c5282" }]
            : []),
        ];
        const places = parsed.map((place, index) => ({
          placeId: place.id,
          factionId: index === 0 ? "f1" : index === 1 ? "f2" : undefined,
          role: index === 0 ? "出发点" : "迎击地",
        }));
        const routes =
          parsed.length > 1 && parsed[0]?.quote
            ? [
                {
                  id: "r1",
                  fromPlaceId: parsed[0].id,
                  toPlaceId: parsed[1]!.id,
                  factionId: "f1",
                  kind: "advance",
                  label: "推进",
                  evidence: [parsed[0].quote],
                },
              ]
            : [];
        return {
          raw: JSON.stringify({
            title: "长章态势",
            summary: {
              overview: "按窗口合并的态势。",
              keyPoints: [],
              uncertainty: [],
            },
            factions,
            places,
            routes,
            controlAreas: [],
            frontLines: [],
            scenes: [
              {
                title: "窗口态势",
                summary: "窗口态势。",
                placeIds: parsed.map((place) => place.id),
                routeIds: routes.length > 0 ? ["r1"] : [],
              },
            ],
          }),
        };
      }
      return { raw: "{}" };
    });

    const fakeClient: LlmClient = {
      name: "fake",
      model: "fake-1",
      complete,
      stream: vi.fn(async () => ({})),
      testConnection: vi.fn(async () => ({ latencyMs: 1 })),
    };

    const saveAnalysis = vi.fn(async () => undefined);
    const analysis = await analyzeChapter(
      { bookId: "book-1", chapterId: "ch-long", scope: "chapter" },
      {
        deps: makeDeps({
          getChapter: vi.fn(async () => longChapter),
          saveAnalysis,
        }),
        clientFactory: () => fakeClient,
      },
    );

    expect(analysis.scope).toBe("chapter");
    expect(analysis.excerpt.start).toBe(0);
    expect(analysis.excerpt.end).toBe(text.length);
    expect(analysis.situation.places.map((place) => place.name).sort()).toEqual([
      "江陵",
      "赤壁",
    ]);
    expect(analysis.situation.routes).toHaveLength(1);
    expect(analysis.situation.scenes.length).toBeGreaterThanOrEqual(2);
    expect(saveAnalysis).toHaveBeenCalledTimes(1);
    expect(analysis.meta.warnings.map((item) => item.code)).not.toContain(
      "INSUFFICIENT_PLACES",
    );
    for (const citation of analysis.situation.citations) {
      expect(text.slice(citation.start, citation.end)).toBe(citation.quote);
    }
    // 3 paragraphs of ~1000 chars => two windows with one overlapping paragraph.
    expect(
      complete.mock.calls.filter((call) =>
        String(call[0]?.system).includes("【任务：地名抽取】"),
      ),
    ).toHaveLength(2);
  });

  it("repairs one invalid JSON response and warns", async () => {
    const complete = vi.fn(async (args: LlmCompleteArgs) => {
      if (args.system.includes("【任务：时期判定】")) {
        return { raw: JSON.stringify({ label: "东汉末年", confidence: 0.6 }) };
      }
      if (args.system.includes("【任务：地名抽取】")) {
        return { raw: "这不是一个 JSON 对象" };
      }
      if (args.system.includes("【任务：JSON 修复】")) {
        return { raw: VALID_MENTIONS };
      }
      if (args.system.includes("【任务：态势分析】")) {
        return { raw: DEFAULT_SITUATION };
      }
      return { raw: "{}" };
    });
    const fakeClient: LlmClient = {
      name: "fake",
      model: "fake-1",
      complete,
      stream: vi.fn(async () => ({})),
      testConnection: vi.fn(async () => ({ latencyMs: 1 })),
    };

    const analysis = await analyzeSelection(
      {
        bookId: "book-1",
        chapterId: "ch-1",
        scope: "selection",
        start: 0,
        end: CHAPTER_TEXT.length,
      },
      { deps: makeDeps(), clientFactory: () => fakeClient },
    );

    expect(analysis.situation.places).toHaveLength(2);
    expect(
      analysis.meta.warnings.some((item) => item.code === "MODEL_JSON_REPAIRED"),
    ).toBe(true);
    expect(
      complete.mock.calls.some((call) =>
        String(call[0]?.system).includes("【任务：JSON 修复】"),
      ),
    ).toBe(true);
  });

  it("throws MODEL_BAD_JSON (without fabricating a result) when repair also fails", async () => {
    const complete = vi.fn(async (args: LlmCompleteArgs) => {
      if (args.system.includes("【任务：时期判定】")) {
        return { raw: JSON.stringify({ label: "东汉末年", confidence: 0.6 }) };
      }
      if (args.system.includes("【任务：地名抽取】")) {
        return { raw: "not json at all" };
      }
      if (args.system.includes("【任务：JSON 修复】")) {
        return { raw: "still not json" };
      }
      return { raw: "{}" };
    });
    const fakeClient: LlmClient = {
      name: "fake",
      model: "fake-1",
      complete,
      stream: vi.fn(async () => ({})),
      testConnection: vi.fn(async () => ({ latencyMs: 1 })),
    };
    const saveAnalysis = vi.fn(async () => undefined);

    await expect(
      analyzeSelection(
        {
          bookId: "book-1",
          chapterId: "ch-1",
          scope: "selection",
          start: 0,
          end: CHAPTER_TEXT.length,
        },
        {
          deps: makeDeps({ saveAnalysis }),
          clientFactory: () => fakeClient,
        },
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.MODEL_BAD_JSON });
    expect(saveAnalysis).not.toHaveBeenCalled();
  });
});
