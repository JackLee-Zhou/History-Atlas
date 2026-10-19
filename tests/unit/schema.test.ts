import { describe, expect, it } from "vitest";
import {
  analysisSchema,
  citationSchema,
  settingsViewSchema,
  situationSchema,
  type Analysis,
} from "@/lib/schema";

const validAnalysis: Analysis = {
  id: "analysis-1",
  bookId: "book-1",
  chapterId: "chapter-1",
  scope: "selection",
  excerpt: { start: 0, end: 12, textHash: "abc" },
  meta: {
    provider: "mock",
    model: "mock-1",
    promptVersion: "p1",
    createdAt: "2026-01-01T00:00:00.000Z",
    cacheHit: false,
    warnings: [],
  },
  situation: {
    title: "赤壁",
    summary: {
      overview: "曹操军自江陵东下。",
      keyPoints: ["江陵为起点"],
      uncertainty: ["兵力未详"],
    },
    factions: [
      { id: "f1", name: "曹操军", color: "#9b2c2c" },
      { id: "f2", name: "孙刘联军", color: "#2c5282" },
    ],
    places: [
      {
        id: "p1",
        name: "江陵",
        category: "city",
        factionId: "f1",
        location: {
          lat: 30.35,
          lng: 112.19,
          precision: "city",
          confidence: 0.8,
          radiusKm: 30,
          source: "gazetteer",
        },
        evidence: ["c1"],
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
          radiusKm: 3,
          source: "gazetteer",
        },
        evidence: ["c2"],
      },
    ],
    routes: [
      {
        id: "r1",
        factionId: "f1",
        fromPlaceId: "p1",
        toPlaceId: "p2",
        kind: "advance",
        label: "顺江东下",
        evidence: ["c1"],
      },
    ],
    controlAreas: [],
    frontLines: [],
    scenes: [
      {
        id: "s1",
        index: 0,
        title: "战前",
        summary: "曹操军东下。",
        placeIds: ["p1", "p2"],
        routeIds: ["r1"],
        areaIds: [],
        frontLineIds: [],
      },
    ],
    citations: [
      { id: "c1", quote: "曹操自江陵", start: 0, end: 6 },
      { id: "c2", quote: "遇于赤壁", start: 6, end: 12 },
    ],
  },
};

describe("schemas", () => {
  it("accepts a valid analysis", () => {
    const parsed = analysisSchema.safeParse(validAnalysis);
    expect(parsed.success).toBe(true);
  });

  it("rejects a place without evidence", () => {
    const broken = structuredClone(validAnalysis);
    broken.situation.places[0].evidence = [];
    expect(situationSchema.safeParse(broken.situation).success).toBe(false);
  });

  it("rejects a citation with an invalid range", () => {
    expect(
      citationSchema.safeParse({ id: "c", quote: "x", start: 5, end: 5 }).success,
    ).toBe(false);
  });

  it("settings view never requires or exposes an api key field", () => {
    const parsed = settingsViewSchema.parse({
      provider: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      hasKey: true,
      keyMasked: "••••••••abcd",
      geocoder: "none",
      autoAnalyze: false,
    });
    expect(parsed).not.toHaveProperty("apiKey");
    expect(parsed.hasKey).toBe(true);
  });
});
