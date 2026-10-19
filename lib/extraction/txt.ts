import type { Warning } from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";

import {
  buildChapterContent,
  deriveTitleFromFilename,
  normalizeParagraphText,
  normalizeTitle,
} from "./content";
import { decodeTextBuffer } from "./decode";
import type { ExtractionOutput, RawChapter } from "./types";
import { extractionWarning } from "./warnings";

/** Fallback chunk size when no chapter headings can be recognised. */
const FALLBACK_CHAPTER_CHARS = 8000;
/** A prelude shorter than this is folded into the first chapter. */
const MIN_PRELUDE_CHARS = 80;
const MAX_HEADING_CHARS = 48;

const CHAPTER_HEADING_RE =
  /^(?:第[〇零一二三四五六七八九十百千万亿两\d]+[回章节卷篇部集]|卷[〇零一二三四五六七八九十百千万亿两\d]+|楔子|序章|序言|引言|引子|前言|尾声|后记|附录|外传|序(?=$|[\s:：·、]))/;

interface DraftChapter {
  title: string;
  lines: string[];
}

function normalizeSourceText(text: string): string {
  return text
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_CHARS) return false;
  return CHAPTER_HEADING_RE.test(trimmed);
}

function splitByLength(lines: string[]): DraftChapter[] {
  const drafts: DraftChapter[] = [];
  let current: string[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const index = drafts.length;
    drafts.push({
      title: drafts.length === 0 ? "全文" : `第 ${index + 1} 部分`,
      lines: current,
    });
    current = [];
    currentChars = 0;
  };

  for (const line of lines) {
    const addition = current.length === 0 ? line.length : line.length + 2;
    if (current.length > 0 && currentChars + addition > FALLBACK_CHAPTER_CHARS) {
      flush();
    }
    current.push(line);
    currentChars += current.length === 1 ? line.length : line.length + 2;
  }
  flush();
  if (drafts.length > 1) {
    drafts.forEach((draft, index) => {
      draft.title = `第 ${index + 1} 部分`;
    });
  }
  return drafts;
}

function splitAtHeadings(lines: string[], headingIndices: number[]): DraftChapter[] {
  const drafts: DraftChapter[] = [];
  const firstHeading = headingIndices[0];
  const prelude = lines.slice(0, firstHeading);

  if (
    prelude.length > 0 &&
    prelude.join("").length >= MIN_PRELUDE_CHARS
  ) {
    drafts.push({ title: "卷首", lines: prelude });
  }

  for (let index = 0; index < headingIndices.length; index += 1) {
    const headingIndex = headingIndices[index];
    const nextHeading =
      index + 1 < headingIndices.length ? headingIndices[index + 1] : lines.length;
    const title = lines[headingIndex].trim();
    let body = lines.slice(headingIndex + 1, nextHeading);

    // Fold a short prelude into the first chapter so no text is lost.
    if (index === 0 && drafts.length === 0 && prelude.length > 0) {
      body = [...prelude, ...body];
    }
    if (body.length === 0) body = [title];
    drafts.push({ title, lines: body });
  }

  return drafts;
}

function toRawChapters(drafts: DraftChapter[]): RawChapter[] {
  const chapters: RawChapter[] = [];
  for (const draft of drafts) {
    const content = buildChapterContent(draft.lines);
    if (!content.text) continue;
    const index = chapters.length;
    chapters.push({
      id: `ch-${index + 1}`,
      title: normalizeTitle(draft.title, `第 ${index + 1} 章`),
      text: content.text,
      paragraphs: content.paragraphs,
      pages: [],
      needsOCR: false,
    });
  }
  return chapters;
}

/**
 * TXT / pasted-text extraction. Chapter detection prefers `第X回/章/卷` style
 * headings; when fewer than two headings exist it falls back to ~8000-char
 * chunks cut on paragraph boundaries.
 */
export function extractTxt(input: {
  buffer: Uint8Array;
  filename: string;
  title?: string;
  format: "txt" | "paste";
}): ExtractionOutput {
  const decoded = decodeTextBuffer(input.buffer);
  const normalized = normalizeSourceText(decoded.text);
  if (!normalized) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "文本内容为空");
  }

  const lines = normalized
    .split("\n")
    .map((line) => normalizeParagraphText(line))
    .filter(Boolean);

  if (lines.length === 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "文本内容为空");
  }

  const headingIndices: number[] = [];
  lines.forEach((line, index) => {
    if (isChapterHeading(line)) headingIndices.push(index);
  });

  const warnings: Warning[] = [];
  let drafts: DraftChapter[];
  if (headingIndices.length >= 2) {
    drafts = splitAtHeadings(lines, headingIndices);
  } else {
    drafts = splitByLength(lines);
    if (drafts.length > 1) {
      warnings.push(
        extractionWarning(
          "TXT_AUTO_SPLIT",
          `未识别到足够的章节标题，已按约 ${FALLBACK_CHAPTER_CHARS} 字自动分段`,
          "info",
        ),
      );
    }
  }

  const chapters = toRawChapters(drafts);
  if (chapters.length === 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "文本内容为空");
  }

  const fallbackTitle =
    input.format === "paste" ? "粘贴文本" : deriveTitleFromFilename(input.filename);
  const bookTitle = normalizeTitle(input.title?.trim() ?? fallbackTitle, fallbackTitle);

  return {
    format: input.format,
    title: bookTitle,
    chapters,
    warnings,
  };
}
