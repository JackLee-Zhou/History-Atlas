import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRECISION_RADIUS_KM } from "@/lib/constants";
import type {
  Analysis,
  AnalysisStreamEvent,
  Chapter,
  Correction,
} from "@/lib/schema";
import { analysisSchema } from "@/lib/schema";
import type { GazetteerData } from "@/lib/gazetteer";
import {
  loadGazetteer,
  resolveMentions,
  scanGazetteer,
} from "@/lib/gazetteer";
import {
  analyzeChapter,
  analyzeSelection,
  type PipelineDeps,
} from "@/lib/pipeline";

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
    {
      id: "wulin",
      name: "乌林",
      aliases: [],
      category: "battlefield",
      periods: [{ label: "东汉末年", startYear: 184, endYear: 220 }],
      modernName: "湖北洪湖",
      admin1: "湖北",
      lat: 29.98,
      lng: 113.45,
      precision: "site",
      confidence: 0.7,
      source: { label: "测试地名库" },
    },
  ],
  modern: [
    {
      id: "modern-chibi",
      name: "赤壁市",
      aliases: ["赤壁"],
      lat: 29.72,
      lng: 113.9,
      admin1: "湖北",
      admin2: "咸宁",
      geonameId: 1,
    },
  ],
  dynasties: [
    { label: "东汉", startYear: 25, endYear: 220, aliases: ["东汉末年"] },
  ],
};

function makeDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    getChapter: vi.fn(async () => chapter),
    listCorrections: vi.fn(async () => []),
    getCachedAnalysis: vi.fn(async () => null),
    setCachedAnalysis: vi.fn(async () => undefined),
    saveAnalysis: vi.fn(async () => undefined),
    getEffectiveSettings: vi.fn(async () => ({
      provider: "rule" as const,
      geocoder: "none" as const,
      autoAnalyze: false,
    })),
    loadGazetteer: vi.fn(async () => gazetteer),
    createLlmClient: vi.fn(() => {
      throw new Error("rule mode must not create a model client");
    }),
    ...overrides,
  };
}

async function runRule(
  overrides: Partial<PipelineDeps> = {},
  chapterInput: Chapter = chapter,
): Promise<{ analysis: Analysis; events: AnalysisStreamEvent[] }> {
  const events: AnalysisStreamEvent[] = [];
  const deps = makeDeps({
    getChapter: vi.fn(async () => chapterInput),
    ...overrides,
  });
  const analysis = await analyzeSelection(
    {
      bookId: "book-1",
      chapterId: "ch-1",
      scope: "selection",
      start: 0,
      end: chapterInput.text.length,
    },
    { deps, emit: (event) => events.push(event) },
  );
  return { analysis, events };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rule-mode pipeline", () => {
  it("returns gazetteer locations, verbatim evidence and one scene without a model", async () => {
    const { analysis, events } = await runRule();
    const parsed = analysisSchema.safeParse(analysis);
    expect(parsed.success).toBe(true);

    expect(analysis.meta.provider).toBe("rule");
    expect(analysis.meta.model).toBe("rule");
    expect(analysis.meta.cacheHit).toBe(false);
    expect(analysis.situation.places.map((place) => place.name).sort()).toEqual([
      "江陵",
      "赤壁",
    ]);
    for (const place of analysis.situation.places) {
      expect(place.location?.source).toBe("gazetteer");
      expect(place.evidence.length).toBeGreaterThan(0);
    }
    const jiangling = analysis.situation.places.find(
      (place) => place.name === "江陵",
    )!;
    const chibi = analysis.situation.places.find((place) => place.name === "赤壁")!;
    expect(jiangling.location).toMatchObject({ lat: 30.35, lng: 112.19 });
    expect(chibi.location).toMatchObject({ lat: 29.72, lng: 113.9 });

    expect(analysis.situation.factions).toEqual([]);
    expect(analysis.situation.routes).toEqual([]);
    expect(analysis.situation.controlAreas).toEqual([]);
    expect(analysis.situation.frontLines).toEqual([]);
    expect(analysis.situation.scenes).toHaveLength(1);
    expect(analysis.situation.summary.overview).toContain("规则模式");

    for (const citation of analysis.situation.citations) {
      expect(CHAPTER_TEXT.slice(citation.start, citation.end)).toBe(
        citation.quote,
      );
      expect(citation.end).toBeGreaterThan(citation.start);
    }

    const stages = events
      .filter((event) => event.type === "stage")
      .map((event) => (event.type === "stage" ? event.stage : ""));
    expect(stages).toEqual(
      expect.arrayContaining([
        "cache",
        "period",
        "places",
        "resolve",
        "situation",
        "validate",
        "persist",
        "done",
      ]),
    );
    expect(events.some((event) => event.type === "result")).toBe(true);
    expect(
      analysis.meta.warnings.some((item) => item.code === "INSUFFICIENT_PLACES"),
    ).toBe(false);
  });

  it("gives user corrections priority over the gazetteer (book-level)", async () => {
    const correction: Correction = {
      id: "corr-1",
      ancientName: "赤壁",
      periodLabel: "东汉末年",
      bookId: "book-1",
      modernName: "用户修正赤壁",
      lat: 30.01,
      lng: 114.02,
      precision: "county",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const { analysis } = await runRule({
      listCorrections: vi.fn(async () => [correction]),
    });
    const chibi = analysis.situation.places.find((place) => place.name === "赤壁")!;
    expect(chibi.location).toMatchObject({
      lat: 30.01,
      lng: 114.02,
      source: "user",
      precision: "county",
      radiusKm: PRECISION_RADIUS_KM.county,
    });
  });

  it("marks ambiguous gazetteer matches as unresolved instead of guessing", async () => {
    const ambiguous: GazetteerData = {
      ...gazetteer,
      ancient: [
        gazetteer.ancient[0]!,
        {
          ...gazetteer.ancient[0]!,
          id: "jiangling-2",
          modernName: "湖北荆州（另一说）",
          lat: 30.4,
          lng: 112.2,
        },
        gazetteer.ancient[1]!,
      ],
    };
    const { analysis } = await runRule({
      loadGazetteer: vi.fn(async () => ambiguous),
    });
    const jiangling = analysis.situation.places.find(
      (place) => place.name === "江陵",
    )!;
    expect(jiangling.location).toBeUndefined();
    expect(jiangling.unresolved?.candidates.length).toBe(2);
    expect(
      analysis.meta.warnings.some((item) => item.code === "AMBIGUOUS_PLACE"),
    ).toBe(true);
    // Only 赤壁 is locatable now, so the text-only degradation is flagged.
    expect(
      analysis.meta.warnings.some((item) => item.code === "INSUFFICIENT_PLACES"),
    ).toBe(true);
  });

  it("returns a text-only analysis when the gazetteer is empty", async () => {
    const { analysis } = await runRule({
      loadGazetteer: vi.fn(async () => ({
        ancient: [],
        modern: [],
        dynasties: [],
      })),
    });
    expect(analysis.situation.places).toEqual([]);
    expect(analysis.situation.routes).toEqual([]);
    expect(analysis.situation.scenes).toHaveLength(1);
    expect(analysis.situation.summary.overview).toContain("规则模式");
    expect(
      analysis.meta.warnings.some((item) => item.code === "INSUFFICIENT_PLACES"),
    ).toBe(true);
  });

  it("analyzes chapters through windows and still yields one rule scene", async () => {
    const { analysis } = await runRule({}, chapter);
    // analyzeChapter ignores start/end and uses paragraph windows.
    const chapterAnalysis = await analyzeChapter(
      {
        bookId: "book-1",
        chapterId: "ch-1",
        scope: "chapter",
      },
      { deps: makeDeps() },
    );
    expect(chapterAnalysis.excerpt.start).toBe(0);
    expect(chapterAnalysis.excerpt.end).toBe(CHAPTER_TEXT.length);
    expect(chapterAnalysis.situation.scenes).toHaveLength(1);
    expect(chapterAnalysis.situation.places.length).toBeGreaterThanOrEqual(2);
    expect(analysis.situation.scenes).toHaveLength(1);
  });
});

describe("gazetteer recall and modern fallback", () => {
  it("scans traditional text and aliases without rewriting the source", async () => {
    const traditional = await scanGazetteer("遇於赤壁，至江陵城下。", {
      gazetteer,
    });
    expect(traditional.map((item) => item.name)).toEqual(
      expect.arrayContaining(["赤壁", "江陵"]),
    );
    const jiangling = traditional.find((item) => item.name === "江陵")!;
    expect(jiangling.quote).toBe("江陵城");
    expect(jiangling.matchedBy).toBe("alias");
    expect(jiangling.ancientPlaceId).toBe("jiangling");
  });

  it("falls back to the modern gazetteer using a 今… hint and sets precision/radius", async () => {
    const resolved = await resolveMentions({
      mentions: [
        {
          name: "赤壁",
          modernHint: "今湖北赤壁市西北",
        },
      ],
      gazetteer: {
        ancient: [],
        modern: gazetteer.modern,
        dynasties: [],
      },
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.location).toMatchObject({
      lat: 29.72,
      lng: 113.9,
      source: "modern",
      precision: "city",
      radiusKm: PRECISION_RADIUS_KM.city,
    });
    expect(resolved[0]!.source).toBe("modern");
  });

  it("returns empty lists and warns when gazetteer files are missing", async () => {
    const missing = path.join(
      os.tmpdir(),
      `history-atlas-missing-gazetteer-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const data = await loadGazetteer({ directory: missing });
    expect(data).toEqual({ ancient: [], modern: [], dynasties: [] });
    expect(warn).toHaveBeenCalled();
  });
});
