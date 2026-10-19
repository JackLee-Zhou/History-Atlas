/**
 * 校验 assets/ 下的内置数据：
 * - 古地名库符合 AncientPlace schema，数量/ID/坐标/来源/备注完整；
 * - 示例书符合 Book/Chapter schema，paragraphs 与 text 的偏移严格一致；
 * - 赤壁样板分析符合 Analysis schema，引用/场景/路线/区域闭合；
 * - 每条 citation.quote 能在对应章节原文中找到（空白归一化），offset 正确。
 *
 * 运行：npm run validate:assets（tsx scripts/validate-assets.ts）
 * 测试也复用导出的 validateAssets()，不联网。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ancientPlaceSchema, dynastySchema } from "../lib/schema/gazetteer";
import { analysisSchema } from "../lib/schema/analysis";
import { bookSchema, chapterSchema } from "../lib/schema/book";
import {
  DEMO_ANALYSIS_ID,
  DEMO_BOOK_ID,
  DEMO_CHAPTER_IDS,
  PRECISION_RADIUS_KM,
} from "../lib/constants";

const GAZETTEER_PATH = "assets/gazetteer/ancient-places.json";
const DYNASTIES_PATH = "assets/gazetteer/dynasties.json";
const DEMO_BOOK_PATH = "assets/demo/books/three-kingdoms.json";
const DEMO_ANALYSIS_PATH = "assets/demo/analyses/chibi.json";

const BBOX = { minLng: 73, maxLng: 135, minLat: 3, maxLat: 54 };

const GAZETTEER_MIN = 100;
const GAZETTEER_MAX = 150;
const ANALYSIS_MIN_PLACES = 10;
const ANALYSIS_MIN_ROUTES = 4;
const ANALYSIS_MIN_SCENES = 3;
const ANALYSIS_MIN_AREAS = 2;
const ANALYSIS_MIN_FRONT_LINES = 1;

/** 与任务要求的最低覆盖集对应的关键地名。 */
const REQUIRED_ANCIENT_NAMES = [
  "长安",
  "洛阳",
  "许昌",
  "邺城",
  "襄阳",
  "江陵",
  "南郡",
  "寿春",
  "合肥",
  "柴桑",
  "夏口",
  "樊口",
  "赤壁",
  "乌林",
  "华容道",
  "当阳",
  "长坂坡",
  "夷陵",
  "汉中",
  "淮南",
  "官渡",
  "乌巢",
  "白马",
  "延津",
  "黎阳",
  "濮阳",
  "汝南",
  "宛城",
  "新野",
] as const;

export interface QuoteSpan {
  start: number;
  end: number;
}

export interface ValidationSummary {
  places: number;
  dynasties: number;
  placesWithUrl: number;
  bookChapters: number;
  analysisPlaces: number;
  routes: number;
  controlAreas: number;
  frontLines: number;
  scenes: number;
  citations: number;
  checkedQuotes: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary: ValidationSummary;
}

const demoBookAssetSchema = z.object({
  book: bookSchema,
  chapters: z.array(chapterSchema).min(1),
});

const emptySummary = (): ValidationSummary => ({
  places: 0,
  dynasties: 0,
  placesWithUrl: 0,
  bookChapters: 0,
  analysisPlaces: 0,
  routes: 0,
  controlAreas: 0,
  frontLines: 0,
  scenes: 0,
  citations: 0,
  checkedQuotes: 0,
});

/**
 * 把连续空白折叠为一个空格，并记录每个归一化字符对应的原文下标。
 * 用于「允许空白归一化」的引文查找。
 */
function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let lastWasWhitespace = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (/\s/.test(char)) {
      if (!lastWasWhitespace) {
        text += " ";
        map.push(index);
        lastWasWhitespace = true;
      }
    } else {
      text += char;
      map.push(index);
      lastWasWhitespace = false;
    }
  }
  return { text, map };
}

/** 查找 quote 在 text 中的所有出现位置（空白归一化，offset 为原文坐标）。 */
export function findQuoteSpans(text: string, quote: string): QuoteSpan[] {
  const { text: normalizedText, map } = normalizeWithMap(text);
  const normalizedQuote = normalizeWithMap(quote).text.trim();
  if (!normalizedQuote) return [];
  const spans: QuoteSpan[] = [];
  let from = 0;
  for (;;) {
    const index = normalizedText.indexOf(normalizedQuote, from);
    if (index < 0) break;
    const start = map[index];
    const end = map[index + normalizedQuote.length - 1] + 1;
    const slice = normalizeWithMap(text.slice(start, end)).text.trim();
    if (slice === normalizedQuote) spans.push({ start, end });
    from = index + Math.max(1, normalizedQuote.length);
  }
  return spans;
}

/** 查找 quote 在 text 中第一次出现的位置（空白归一化）。 */
export function findQuoteSpan(
  text: string,
  quote: string,
): QuoteSpan | null {
  return findQuoteSpans(text, quote)[0] ?? null;
}

function inBbox(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lng >= BBOX.minLng &&
    lng <= BBOX.maxLng &&
    lat >= BBOX.minLat &&
    lat <= BBOX.maxLat
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function loadJson(
  root: string,
  relativePath: string,
  errors: string[],
): Promise<unknown | null> {
  const file = path.join(root, relativePath);
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch (error) {
    errors.push(
      `${relativePath}: 读取或解析失败（${error instanceof Error ? error.message : String(error)}）`,
    );
    return null;
  }
}

function formatIssues(error: z.ZodError, prefix: string): string[] {
  return error.issues.map(
    (issue) => `${prefix}${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
}

interface PositionLike {
  type: string;
  coordinates: unknown;
}

function checkGeometry(
  label: string,
  geometry: PositionLike,
  errors: string[],
): void {
  const coordinates = geometry.coordinates;
  const rings =
    geometry.type === "Polygon"
      ? Array.isArray(coordinates)
        ? (coordinates as unknown[])
        : []
      : [coordinates];

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < (geometry.type === "Polygon" ? 3 : 2)) {
      errors.push(`${label}: 几何坐标数量不足`);
      continue;
    }
    for (const position of ring) {
      if (!Array.isArray(position) || position.length !== 2) {
        errors.push(`${label}: 坐标不是 [lng, lat] 二元组`);
        continue;
      }
      const [lng, lat] = position as [number, number];
      if (!inBbox(lat, lng)) {
        errors.push(`${label}: 坐标越界 (${lat}, ${lng})`);
      }
    }
    if (geometry.type === "Polygon") {
      const first = ring[0] as [number, number];
      const last = ring[ring.length - 1] as [number, number];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        errors.push(`${label}: Polygon 环未闭合`);
      }
    }
  }
}

export async function validateAssets(
  root: string = process.cwd(),
): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const summary = emptySummary();

  /* ------------------------------------------------------------------ */
  /* 1. 古地名库                                                         */
  /* ------------------------------------------------------------------ */
  const gazetteerRaw = await loadJson(root, GAZETTEER_PATH, errors);
  if (gazetteerRaw !== null) {
    if (!Array.isArray(gazetteerRaw)) {
      errors.push(`${GAZETTEER_PATH}: 顶层必须是数组`);
    } else {
      summary.places = gazetteerRaw.length;
      if (
        gazetteerRaw.length < GAZETTEER_MIN ||
        gazetteerRaw.length > GAZETTEER_MAX
      ) {
        errors.push(
          `${GAZETTEER_PATH}: 期望 ${GAZETTEER_MIN}–${GAZETTEER_MAX} 条，实际 ${gazetteerRaw.length} 条`,
        );
      }
      const ids = new Set<string>();
      const names = new Map<string, string>();
      for (const [index, raw] of gazetteerRaw.entries()) {
        const parsed = ancientPlaceSchema.safeParse(raw);
        if (!parsed.success) {
          errors.push(...formatIssues(parsed.error, `古地名[${index}]: `));
          continue;
        }
        const place = parsed.data;
        const record = raw as Record<string, unknown>;
        for (const field of ["aliases", "periods"] as const) {
          if (!Object.prototype.hasOwnProperty.call(record, field)) {
            errors.push(`古地名 ${place.id}: 缺少字段 ${field}`);
          }
        }
        if (place.periods.length === 0) {
          errors.push(`古地名 ${place.id}: periods 不能为空`);
        }
        if (!place.note || place.note.trim() === "") {
          errors.push(`古地名 ${place.id}: note 必须说明定位依据或存疑`);
        }
        if (ids.has(place.id)) {
          errors.push(`古地名: 重复 id ${place.id}`);
        }
        ids.add(place.id);
        const previous = names.get(place.name);
        if (previous) {
          errors.push(`古地名: 同名 ${place.name}（${previous} / ${place.id}）`);
        }
        names.set(place.name, place.id);
        if (!inBbox(place.lat, place.lng)) {
          errors.push(
            `古地名 ${place.id}: 坐标越界 (${place.lat}, ${place.lng})`,
          );
        }
        if (place.source.url) summary.placesWithUrl += 1;
      }
      for (const required of REQUIRED_ANCIENT_NAMES) {
        if (!names.has(required)) {
          errors.push(`古地名: 缺少关键地名 ${required}`);
        }
      }
      if (summary.placesWithUrl === 0) {
        warnings.push("古地名库没有任何 source.url");
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 1b. 朝代区间                                                       */
  /* ------------------------------------------------------------------ */
  const dynastyRaw = await loadJson(root, DYNASTIES_PATH, errors);
  if (dynastyRaw !== null) {
    if (!Array.isArray(dynastyRaw)) {
      errors.push(`${DYNASTIES_PATH}: 顶层必须是数组`);
    } else {
      summary.dynasties = dynastyRaw.length;
      if (dynastyRaw.length < 10) {
        errors.push(`${DYNASTIES_PATH}: 至少需要 10 个朝代/时期，实际 ${dynastyRaw.length}`);
      }
      const labels = new Set<string>();
      for (const [index, raw] of dynastyRaw.entries()) {
        const parsed = dynastySchema.safeParse(raw);
        if (!parsed.success) {
          errors.push(...formatIssues(parsed.error, `朝代[${index}]: `));
          continue;
        }
        const dynasty = parsed.data;
        if (labels.has(dynasty.label)) {
          errors.push(`朝代: 重复 label ${dynasty.label}`);
        }
        labels.add(dynasty.label);
        if (
          dynasty.startYear !== undefined &&
          dynasty.endYear !== undefined &&
          dynasty.startYear > dynasty.endYear
        ) {
          errors.push(`朝代 ${dynasty.label}: startYear 大于 endYear`);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2. 示例书                                                           */
  /* ------------------------------------------------------------------ */
  const bookRaw = await loadJson(root, DEMO_BOOK_PATH, errors);
  let demoBook: z.infer<typeof demoBookAssetSchema> | null = null;
  if (bookRaw !== null) {
    const parsed = demoBookAssetSchema.safeParse(bookRaw);
    if (!parsed.success) {
      errors.push(...formatIssues(parsed.error, "示例书: "));
    } else {
      demoBook = parsed.data;
      const { book, chapters } = parsed.data;
      summary.bookChapters = chapters.length;
      if (book.id !== DEMO_BOOK_ID) {
        errors.push(`示例书: book.id 应为 ${DEMO_BOOK_ID}，实际 ${book.id}`);
      }
      if (book.title !== "三国演义（赤壁节选）") {
        errors.push(`示例书: title 应为「三国演义（赤壁节选）」，实际「${book.title}」`);
      }
      if (book.author !== "罗贯中") {
        errors.push(`示例书: author 应为「罗贯中」，实际「${book.author ?? ""}」`);
      }
      if (book.format !== "txt") {
        errors.push(`示例书: format 应为 txt，实际 ${book.format}`);
      }
      if (chapters.length !== DEMO_CHAPTER_IDS.length) {
        errors.push(
          `示例书: 应为 ${DEMO_CHAPTER_IDS.length} 章，实际 ${chapters.length} 章`,
        );
      }
      if (book.chapters.length !== chapters.length) {
        errors.push(
          `示例书: book.chapters 元数据 ${book.chapters.length} 条，正文章节 ${chapters.length} 条`,
        );
      }
      const chapterIds = new Set<string>();
      for (const [index, chapter] of chapters.entries()) {
        if (chapterIds.has(chapter.id)) {
          errors.push(`示例书: 重复 chapter id ${chapter.id}`);
        }
        chapterIds.add(chapter.id);
        const meta = book.chapters.find((item) => item.id === chapter.id);
        if (!meta) {
          errors.push(`示例书: book.chapters 缺少 ${chapter.id} 的元数据`);
        } else {
          if (meta.index !== index) {
            errors.push(
              `示例书: ${chapter.id} 的 chapterMeta.index 应为 ${index}，实际 ${meta.index}`,
            );
          }
          if (meta.charCount !== chapter.text.length) {
            errors.push(
              `示例书: ${chapter.id} 的 charCount 应为 ${chapter.text.length}，实际 ${meta.charCount}`,
            );
          }
          if (meta.title !== chapter.title) {
            errors.push(
              `示例书: ${chapter.id} 的 chapterMeta.title 与正文章节标题不一致`,
            );
          }
        }
        if (chapter.bookId !== book.id) {
          errors.push(
            `示例书: ${chapter.id}.bookId 应为 ${book.id}，实际 ${chapter.bookId}`,
          );
        }
        if (chapter.text.length === 0) {
          errors.push(`示例书: ${chapter.id} 正文为空`);
        }
        const joined = chapter.paragraphs.map((item) => item.text).join("\n\n");
        if (joined !== chapter.text) {
          errors.push(
            `示例书: ${chapter.id}.text 不是 paragraphs 以 "\\n\\n" 拼接的结果`,
          );
        }
        let cursor = 0;
        for (const [paragraphIndex, paragraph] of chapter.paragraphs.entries()) {
          if (paragraph.start !== cursor) {
            errors.push(
              `示例书: ${chapter.id} 第 ${paragraphIndex} 段 start 应为 ${cursor}，实际 ${paragraph.start}`,
            );
          }
          if (paragraph.text.length === 0) {
            errors.push(
              `示例书: ${chapter.id} 第 ${paragraphIndex} 段为空段落`,
            );
          }
          cursor = paragraph.start + paragraph.text.length + 2;
        }
        if (
          chapter.paragraphs.length > 0 &&
          cursor - 2 !== chapter.text.length
        ) {
          errors.push(
            `示例书: ${chapter.id} 段落偏移总长 ${cursor - 2} 与 text 长度 ${chapter.text.length} 不一致`,
          );
        }
      }
      for (const expected of DEMO_CHAPTER_IDS) {
        if (!chapterIds.has(expected)) {
          errors.push(`示例书: 缺少章节 ${expected}`);
        }
      }
      for (const chapterId of chapterIds) {
        if (!(DEMO_CHAPTER_IDS as readonly string[]).includes(chapterId)) {
          errors.push(`示例书: 多出未预期的章节 ${chapterId}`);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* 3. 样板分析                                                         */
  /* ------------------------------------------------------------------ */
  const analysisRaw = await loadJson(root, DEMO_ANALYSIS_PATH, errors);
  if (analysisRaw !== null) {
    const parsed = analysisSchema.safeParse(analysisRaw);
    if (!parsed.success) {
      errors.push(...formatIssues(parsed.error, "样板分析: "));
    } else {
      const analysis = parsed.data;
      const situation = analysis.situation;
      summary.analysisPlaces = situation.places.length;
      summary.routes = situation.routes.length;
      summary.controlAreas = situation.controlAreas.length;
      summary.frontLines = situation.frontLines.length;
      summary.scenes = situation.scenes.length;
      summary.citations = situation.citations.length;

      if (analysis.id !== DEMO_ANALYSIS_ID) {
        errors.push(
          `样板分析: id 应为 ${DEMO_ANALYSIS_ID}，实际 ${analysis.id}`,
        );
      }
      if (analysis.bookId !== DEMO_BOOK_ID) {
        errors.push(
          `样板分析: bookId 应为 ${DEMO_BOOK_ID}，实际 ${analysis.bookId}`,
        );
      }
      if (analysis.scope !== "chapter") {
        errors.push(`样板分析: scope 应为 chapter，实际 ${analysis.scope}`);
      }

      const chapter =
        demoBook?.chapters.find((item) => item.id === analysis.chapterId) ?? null;
      if (!chapter) {
        errors.push(
          `样板分析: chapterId ${analysis.chapterId} 在示例书中不存在`,
        );
      } else {
        if (analysis.excerpt.start !== 0) {
          errors.push(
            `样板分析: chapter 范围 excerpt.start 应为 0，实际 ${analysis.excerpt.start}`,
          );
        }
        if (analysis.excerpt.end !== chapter.text.length) {
          errors.push(
            `样板分析: excerpt.end 应为 ${chapter.text.length}，实际 ${analysis.excerpt.end}`,
          );
        }
        if (analysis.excerpt.textHash !== sha256(chapter.text)) {
          errors.push("样板分析: excerpt.textHash 与章节原文 SHA-256 不一致");
        }
      }

      if (situation.factions.length < 2) {
        errors.push("样板分析: 至少需要 2 个 faction");
      }
      const factionIds = new Set<string>();
      for (const faction of situation.factions) {
        if (factionIds.has(faction.id)) {
          errors.push(`样板分析: 重复 faction id ${faction.id}`);
        }
        factionIds.add(faction.id);
      }

      const placeIds = new Set<string>();
      for (const place of situation.places) {
        if (placeIds.has(place.id)) {
          errors.push(`样板分析: 重复 place id ${place.id}`);
        }
        placeIds.add(place.id);
        if (!place.location) {
          errors.push(`样板分析: place ${place.id} 缺少 location（样板不得待考）`);
        } else {
          if (!inBbox(place.location.lat, place.location.lng)) {
            errors.push(
              `样板分析: place ${place.id} 坐标越界 (${place.location.lat}, ${place.location.lng})`,
            );
          }
          if (place.location.radiusKm !== PRECISION_RADIUS_KM[place.location.precision]) {
            errors.push(
              `样板分析: place ${place.id} radiusKm 与 precision 不匹配`,
            );
          }
        }
        if (place.factionId && !factionIds.has(place.factionId)) {
          errors.push(
            `样板分析: place ${place.id} 引用不存在的 faction ${place.factionId}`,
          );
        }
      }
      if (situation.places.length < ANALYSIS_MIN_PLACES) {
        errors.push(
          `样板分析: 地点不足 ${ANALYSIS_MIN_PLACES} 个（实际 ${situation.places.length}）`,
        );
      }

      const routeIds = new Set<string>();
      for (const route of situation.routes) {
        if (routeIds.has(route.id)) {
          errors.push(`样板分析: 重复 route id ${route.id}`);
        }
        routeIds.add(route.id);
        for (const endpoint of [route.fromPlaceId, route.toPlaceId]) {
          if (!placeIds.has(endpoint)) {
            errors.push(
              `样板分析: route ${route.id} 引用不存在的地点 ${endpoint}`,
            );
          }
        }
        if (route.factionId && !factionIds.has(route.factionId)) {
          errors.push(
            `样板分析: route ${route.id} 引用不存在的 faction ${route.factionId}`,
          );
        }
      }
      if (situation.routes.length < ANALYSIS_MIN_ROUTES) {
        errors.push(
          `样板分析: 路线不足 ${ANALYSIS_MIN_ROUTES} 条（实际 ${situation.routes.length}）`,
        );
      }

      const areaIds = new Set<string>();
      for (const area of situation.controlAreas) {
        if (areaIds.has(area.id)) {
          errors.push(`样板分析: 重复 controlArea id ${area.id}`);
        }
        areaIds.add(area.id);
        if (!factionIds.has(area.factionId)) {
          errors.push(
            `样板分析: controlArea ${area.id} 引用不存在的 faction ${area.factionId}`,
          );
        }
        checkGeometry(`controlArea ${area.id}`, area.geometry, errors);
      }
      if (situation.controlAreas.length < ANALYSIS_MIN_AREAS) {
        errors.push(
          `样板分析: 控制区不足 ${ANALYSIS_MIN_AREAS} 个（实际 ${situation.controlAreas.length}）`,
        );
      }

      const frontLineIds = new Set<string>();
      for (const frontLine of situation.frontLines) {
        if (frontLineIds.has(frontLine.id)) {
          errors.push(`样板分析: 重复 frontLine id ${frontLine.id}`);
        }
        frontLineIds.add(frontLine.id);
        for (const factionId of frontLine.factionIds) {
          if (!factionIds.has(factionId)) {
            errors.push(
              `样板分析: frontLine ${frontLine.id} 引用不存在的 faction ${factionId}`,
            );
          }
        }
        checkGeometry(`frontLine ${frontLine.id}`, frontLine.geometry, errors);
      }
      if (situation.frontLines.length < ANALYSIS_MIN_FRONT_LINES) {
        errors.push(
          `样板分析: 对峙线不足 ${ANALYSIS_MIN_FRONT_LINES} 条（实际 ${situation.frontLines.length}）`,
        );
      }

      const sceneIds = new Set<string>();
      const sceneIndexes = new Set<number>();
      for (const scene of situation.scenes) {
        if (sceneIds.has(scene.id)) {
          errors.push(`样板分析: 重复 scene id ${scene.id}`);
        }
        sceneIds.add(scene.id);
        if (sceneIndexes.has(scene.index)) {
          errors.push(`样板分析: 重复 scene.index ${scene.index}`);
        }
        sceneIndexes.add(scene.index);
        for (const id of scene.placeIds) {
          if (!placeIds.has(id)) {
            errors.push(`样板分析: scene ${scene.id} 引用不存在的 place ${id}`);
          }
        }
        for (const id of scene.routeIds) {
          if (!routeIds.has(id)) {
            errors.push(`样板分析: scene ${scene.id} 引用不存在的 route ${id}`);
          }
        }
        for (const id of scene.areaIds) {
          if (!areaIds.has(id)) {
            errors.push(`样板分析: scene ${scene.id} 引用不存在的 controlArea ${id}`);
          }
        }
        for (const id of scene.frontLineIds) {
          if (!frontLineIds.has(id)) {
            errors.push(
              `样板分析: scene ${scene.id} 引用不存在的 frontLine ${id}`,
            );
          }
        }
        if (scene.camera && !inBbox(scene.camera.center[1], scene.camera.center[0])) {
          errors.push(`样板分析: scene ${scene.id} 的 camera.center 越界`);
        }
      }
      if (situation.scenes.length < ANALYSIS_MIN_SCENES) {
        errors.push(
          `样板分析: 场景不足 ${ANALYSIS_MIN_SCENES} 个（实际 ${situation.scenes.length}）`,
        );
      }

      const citationIds = new Set<string>();
      for (const citation of situation.citations) {
        if (citationIds.has(citation.id)) {
          errors.push(`样板分析: 重复 citation id ${citation.id}`);
        }
        citationIds.add(citation.id);
        if (citation.quote.trim() === "") {
          errors.push(`样板分析: citation ${citation.id} 的 quote 为空`);
          continue;
        }
        if (!chapter) continue;
        const normalizedQuote = normalizeWithMap(citation.quote).text.trim();
        if (!normalizedQuote) {
          errors.push(`样板分析: citation ${citation.id} 的 quote 归一化后为空`);
          continue;
        }
        if (
          citation.end > chapter.text.length ||
          citation.start >= citation.end
        ) {
          errors.push(
            `样板分析: citation ${citation.id} 的 offset 越界或倒置 (${citation.start}-${citation.end})`,
          );
          continue;
        }
        const slice = normalizeWithMap(
          chapter.text.slice(citation.start, citation.end),
        ).text.trim();
        if (slice !== normalizedQuote) {
          errors.push(
            `样板分析: citation ${citation.id} 的 quote 与 offset 处原文不一致`,
          );
          continue;
        }
        const spans = findQuoteSpans(chapter.text, citation.quote);
        summary.checkedQuotes += 1;
        if (spans.length === 0) {
          errors.push(
            `样板分析: citation ${citation.id} 的 quote 在章节 ${chapter.id} 中找不到`,
          );
          continue;
        }
        if (
          !spans.some(
            (span) => span.start === citation.start && span.end === citation.end,
          )
        ) {
          errors.push(
            `样板分析: citation ${citation.id} 的 offset 与 quote 实际位置不符（期望 ${spans[0].start}-${spans[0].end}）`,
          );
        }
      }

      const referencedCitations = new Set<string>();
      const evidenceOwners: Array<{ label: string; evidence: string[] }> = [
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
      for (const owner of evidenceOwners) {
        if (owner.evidence.length === 0) {
          errors.push(`样板分析: ${owner.label} 没有 evidence`);
        }
        for (const citationId of owner.evidence) {
          referencedCitations.add(citationId);
          if (!citationIds.has(citationId)) {
            errors.push(
              `样板分析: ${owner.label} 引用不存在的 citation ${citationId}`,
            );
          }
        }
      }
      const unreferenced = [...citationIds].filter(
        (id) => !referencedCitations.has(id),
      );
      if (unreferenced.length > 0) {
        warnings.push(
          `样板分析: 有 ${unreferenced.length} 条 citation 未被要素引用（${unreferenced.join(", ")}）`,
        );
      }

      if (analysis.meta.provider !== "demo") {
        errors.push(
          `样板分析: meta.provider 应为 demo（内置人工样板），实际 ${analysis.meta.provider}`,
        );
      }
      if (analysis.meta.model !== "curated") {
        errors.push(
          `样板分析: meta.model 应为 curated，实际 ${analysis.meta.model}`,
        );
      }
      if (analysis.meta.promptVersion !== "p1") {
        errors.push(
          `样板分析: meta.promptVersion 应为 p1，实际 ${analysis.meta.promptVersion}`,
        );
      }
      if (analysis.meta.cacheHit) {
        errors.push("样板分析: meta.cacheHit 应为 false");
      }
      if (analysis.meta.warnings.length > 0) {
        warnings.push(
          `样板分析: meta.warnings 非空（${analysis.meta.warnings.length} 条）`,
        );
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

async function main(): Promise<void> {
  const report = await validateAssets(process.cwd());
  const { summary } = report;
  const summaryText =
    `古地名 ${summary.places} 条（带 URL ${summary.placesWithUrl} 条）；` +
    `朝代 ${summary.dynasties} 条；` +
    `示例书 ${summary.bookChapters} 章；` +
    `样板 ${summary.analysisPlaces} 地点 / ${summary.routes} 路线 / ` +
    `${summary.controlAreas} 控制区 / ${summary.frontLines} 对峙线 / ` +
    `${summary.scenes} 幕 / ${summary.citations} citations（quote 校验 ${summary.checkedQuotes} 条）`;

  if (report.errors.length > 0) {
    console.error(`✗ assets 校验失败：${report.errors.length} 项`);
    for (const error of report.errors) console.error(`  - ${error}`);
    if (report.warnings.length > 0) {
      for (const warning of report.warnings) console.error(`  ! ${warning}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`✓ assets 校验通过：${summaryText}`);
  for (const warning of report.warnings) console.warn(`  ! ${warning}`);
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  path.resolve(invokedPath) === fileURLToPath(import.meta.url)
) {
  void main();
}
