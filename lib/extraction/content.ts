import type { Paragraph } from "@/lib/schema";

/**
 * A chapter's text is *defined* as its paragraphs joined with a blank line, and
 * every `paragraph.start` is the absolute offset into that text. All extractors
 * go through this module so citations can rely on the invariant:
 *
 *   chapter.text === paragraphs.map((p) => p.text).join("\n\n")
 *   chapter.text.slice(p.start, p.start + p.text.length) === p.text
 */
export interface ChapterContent {
  text: string;
  paragraphs: Paragraph[];
}

/** Collapse rendered block text into a single clean paragraph string. */
export function normalizeParagraphText(raw: string): string {
  return raw
    .replace(/\uFEFF/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ *\n */g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function chapterTextFromParagraphs(paragraphs: Paragraph[]): string {
  return paragraphs.map((paragraph) => paragraph.text).join("\n\n");
}

/** Build `text` + offsets from raw paragraph strings, dropping empty entries. */
export function buildChapterContent(rawParagraphs: string[]): ChapterContent {
  const builder = createChapterContentBuilder();
  for (const raw of rawParagraphs) builder.add(raw);
  return builder.finish();
}

export interface ChapterContentBuilder {
  readonly paragraphs: Paragraph[];
  /** Current text length (number of UTF-16 code units). */
  readonly length: number;
  add(raw: string): Paragraph | null;
  finish(): ChapterContent;
}

/**
 * Incremental builder used by the PDF extractor, which needs to record page
 * ranges while paragraphs are appended.
 */
export function createChapterContentBuilder(): ChapterContentBuilder {
  const paragraphs: Paragraph[] = [];
  let length = 0;

  return {
    get paragraphs() {
      return paragraphs;
    },
    get length() {
      return length;
    },
    add(raw: string): Paragraph | null {
      const text = normalizeParagraphText(raw);
      if (!text) return null;
      if (paragraphs.length > 0) length += 2; // "\n\n"
      const paragraph: Paragraph = { start: length, text };
      paragraphs.push(paragraph);
      length += text.length;
      return paragraph;
    },
    finish(): ChapterContent {
      return {
        text: chapterTextFromParagraphs(paragraphs),
        paragraphs: [...paragraphs],
      };
    },
  };
}

/**
 * Throws when a chapter violates the offset invariant. Used right before data is
 * persisted so a buggy extractor can never store chapters that break citations.
 */
export function validateChapterOffsets(chapter: {
  text: string;
  paragraphs: Paragraph[];
}): void {
  if (chapterTextFromParagraphs(chapter.paragraphs) !== chapter.text) {
    throw new Error("chapter text does not match paragraphs join");
  }
  let expectedStart = 0;
  for (const paragraph of chapter.paragraphs) {
    if (paragraph.start !== expectedStart) {
      throw new Error(
        `paragraph offset mismatch: expected ${expectedStart}, got ${paragraph.start}`,
      );
    }
    const actual = chapter.text.slice(
      paragraph.start,
      paragraph.start + paragraph.text.length,
    );
    if (actual !== paragraph.text) {
      throw new Error(`paragraph text mismatch at offset ${paragraph.start}`);
    }
    expectedStart = paragraph.start + paragraph.text.length + 2;
  }
}

/** Derive a readable title from an upload filename (extension is only a hint). */
export function deriveTitleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const withoutExtension = base.replace(/\.(epub|pdf|txt|text|md)$/i, "");
  const cleaned = withoutExtension.replace(/[_-]+/g, " ").trim();
  return cleaned || "未命名文本";
}

/** Trim titles to a sane UI length while keeping at least one character. */
export function normalizeTitle(title: string, fallback: string): string {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned;
}
