import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analysisSchema, type Analysis } from "@/lib/schema/analysis";
import { ancientPlaceSchema, type AncientPlace } from "@/lib/schema/gazetteer";
import { bookSchema, chapterSchema, type Book, type Chapter } from "@/lib/schema/book";
import {
  DEMO_ANALYSIS_ID,
  DEMO_BOOK_ID,
} from "@/lib/constants";
import { findQuoteSpan, validateAssets } from "../../scripts/validate-assets";

const ROOT = process.cwd();

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8")) as unknown;
}

async function loadDemo(): Promise<{
  book: Book;
  chapters: Chapter[];
  analysis: Analysis;
}> {
  const bookAsset = (await readJson(
    "assets/demo/books/three-kingdoms.json",
  )) as { book: unknown; chapters: unknown[] };
  const analysisRaw = await readJson("assets/demo/analyses/chibi.json");
  return {
    book: bookSchema.parse(bookAsset.book),
    chapters: bookAsset.chapters.map((item) => chapterSchema.parse(item)),
    analysis: analysisSchema.parse(analysisRaw),
  };
}

describe("内置 assets", () => {
  it("通过 validate-assets 全量校验", async () => {
    const report = await validateAssets(ROOT);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.summary.places).toBeGreaterThanOrEqual(100);
    expect(report.summary.places).toBeLessThanOrEqual(150);
    expect(report.summary.checkedQuotes).toBe(report.summary.citations);
    expect(report.summary.dynasties).toBeGreaterThanOrEqual(10);
  });

  it("古地名库字段完整、id 唯一、坐标在中国及周边 bbox 内", async () => {
    const raw = await readJson("assets/gazetteer/ancient-places.json");
    expect(Array.isArray(raw)).toBe(true);
    const places: AncientPlace[] = (raw as unknown[]).map((item) =>
      ancientPlaceSchema.parse(item),
    );
    expect(places.length).toBeGreaterThanOrEqual(100);
    expect(places.length).toBeLessThanOrEqual(150);

    const ids = new Set<string>();
    const names = new Set<string>();
    for (const place of places) {
      expect(place.id.length).toBeGreaterThan(0);
      expect(ids.has(place.id)).toBe(false);
      ids.add(place.id);
      names.add(place.name);
      expect(place.aliases.length).toBeGreaterThan(0);
      expect(place.periods.length).toBeGreaterThan(0);
      expect(place.source.label.length).toBeGreaterThan(0);
      expect(place.note?.trim().length).toBeGreaterThan(0);
      expect(place.lng).toBeGreaterThanOrEqual(73);
      expect(place.lng).toBeLessThanOrEqual(135);
      expect(place.lat).toBeGreaterThanOrEqual(3);
      expect(place.lat).toBeLessThanOrEqual(54);
    }

    for (const required of [
      "赤壁",
      "乌林",
      "华容道",
      "夏口",
      "樊口",
      "柴桑",
      "许昌",
      "襄阳",
      "南郡",
      "夷陵",
      "合肥",
      "官渡",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("示例书 paragraphs 以 \\n\\n 拼接后与 text 完全一致，start 偏移正确", async () => {
    const { book, chapters } = await loadDemo();
    expect(book.id).toBe(DEMO_BOOK_ID);
    expect(chapters).toHaveLength(2);
    expect(book.chapters).toHaveLength(2);

    for (const chapter of chapters) {
      expect(chapter.bookId).toBe(book.id);
      expect(chapter.paragraphs.length).toBeGreaterThan(0);
      expect(chapter.paragraphs.map((item) => item.text).join("\n\n")).toBe(
        chapter.text,
      );

      let cursor = 0;
      for (const paragraph of chapter.paragraphs) {
        expect(paragraph.start).toBe(cursor);
        expect(paragraph.text.length).toBeGreaterThan(0);
        cursor += paragraph.text.length + 2;
      }
      expect(cursor - 2).toBe(chapter.text.length);
    }
  });

  it("赤壁样板至少有 10 地点 / 4 路线 / 3 场景，所有 citation 可在原文逐字找到", async () => {
    const { chapters, analysis } = await loadDemo();
    expect(analysis.id).toBe(DEMO_ANALYSIS_ID);
    expect(analysis.bookId).toBe(DEMO_BOOK_ID);
    expect(analysis.scope).toBe("chapter");
    expect(analysis.meta.provider).toBe("demo");
    expect(analysis.meta.model).toBe("curated");

    const situation = analysis.situation;
    expect(situation.places.length).toBeGreaterThanOrEqual(10);
    expect(situation.routes.length).toBeGreaterThanOrEqual(4);
    expect(situation.scenes.length).toBeGreaterThanOrEqual(3);
    expect(situation.controlAreas.length).toBeGreaterThanOrEqual(2);
    expect(situation.frontLines.length).toBeGreaterThanOrEqual(1);
    expect(situation.factions.length).toBe(2);

    const chapter = chapters.find((item) => item.id === analysis.chapterId);
    expect(chapter).toBeDefined();
    if (!chapter) return;

    expect(analysis.excerpt.start).toBe(0);
    expect(analysis.excerpt.end).toBe(chapter.text.length);

    const citations = new Map(
      situation.citations.map((citation) => [citation.id, citation]),
    );
    for (const citation of situation.citations) {
      expect(citation.quote.trim().length).toBeGreaterThan(0);
      const span = findQuoteSpan(chapter.text, citation.quote);
      expect(span).not.toBeNull();
      expect(span).toEqual({ start: citation.start, end: citation.end });
      expect(chapter.text.slice(citation.start, citation.end)).toBe(
        citation.quote,
      );
    }

    const placeIds = new Set(situation.places.map((place) => place.id));
    const routeIds = new Set(situation.routes.map((route) => route.id));
    for (const route of situation.routes) {
      expect(placeIds.has(route.fromPlaceId)).toBe(true);
      expect(placeIds.has(route.toPlaceId)).toBe(true);
    }

    const evidenceGroups = [
      ...situation.places.map((place) => ({
        label: `place ${place.id}`,
        evidence: place.evidence,
      })),
      ...situation.routes.map((route) => ({
        label: `route ${route.id}`,
        evidence: route.evidence,
      })),
      ...situation.controlAreas.map((area) => ({
        label: `controlArea ${area.id}`,
        evidence: area.evidence,
      })),
      ...situation.frontLines.map((frontLine) => ({
        label: `frontLine ${frontLine.id}`,
        evidence: frontLine.evidence,
      })),
    ];
    for (const group of evidenceGroups) {
      expect(group.evidence.length).toBeGreaterThan(0);
      for (const citationId of group.evidence) {
        expect(
          citations.has(citationId),
          `${group.label} 引用了不存在的 citation ${citationId}`,
        ).toBe(true);
      }
    }

    for (const scene of situation.scenes) {
      for (const placeId of scene.placeIds) {
        expect(placeIds.has(placeId)).toBe(true);
      }
      for (const routeId of scene.routeIds) {
        expect(routeIds.has(routeId)).toBe(true);
      }
    }
  });
});
