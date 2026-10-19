import { randomUUID } from "node:crypto";

import {
  bookSchema,
  chapterSchema,
  type Chapter,
} from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";

import {
  deriveTitleFromFilename,
  normalizeTitle,
  validateChapterOffsets,
} from "./content";
import { assertImportSize, resolveImportFormat } from "./detect";
import { extractEpub } from "./epub";
import { extractPdf } from "./pdf";
import { extractTxt } from "./txt";
import type { ExtractInput, ExtractResult, ExtractionOutput } from "./types";

export type { ExtractInput, ExtractResult } from "./types";

/**
 * Unified extraction entry point.
 *
 * Format is resolved from magic bytes (never from the file extension), the file
 * is parsed with an open-source library, and the result is validated against
 * the Book/Chapter schemas before it can be persisted.
 */
export async function extractBook(input: ExtractInput): Promise<ExtractResult> {
  const buffer =
    input.buffer instanceof Uint8Array
      ? input.buffer
      : new Uint8Array(input.buffer);
  assertImportSize(buffer.byteLength);

  const filename = input.filename?.trim() || "untitled";
  const format = await resolveImportFormat({ ...input, buffer, filename });

  let output: ExtractionOutput;
  try {
    switch (format) {
      case "epub":
        output = await extractEpub({
          buffer,
          filename,
          title: input.title,
        });
        break;
      case "pdf":
        output = await extractPdf({
          buffer,
          filename,
          title: input.title,
        });
        break;
      case "paste":
        output = extractTxt({
          buffer,
          filename,
          title: input.title,
          format: "paste",
        });
        break;
      case "txt":
        output = extractTxt({
          buffer,
          filename,
          title: input.title,
          format: "txt",
        });
        break;
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Never log manuscript content: keep only the library error name.
    console.error(
      `[extraction] ${format} extraction failed:`,
      error instanceof Error ? error.name : "unknown error",
    );
    throw new AppError(
      ERROR_CODES.BAD_REQUEST,
      "文件解析失败，请确认文件完整且未加密",
      { cause: error },
    );
  }

  if (output.chapters.length === 0) {
    throw new AppError(
      ERROR_CODES.NO_TEXT_LAYER,
      "没有从文件中提取到可读文本",
      { status: 422 },
    );
  }

  const bookId = randomUUID();
  const chapters: Chapter[] = output.chapters.map((raw) =>
    chapterSchema.parse({
      id: raw.id,
      bookId,
      title: raw.title,
      text: raw.text,
      paragraphs: raw.paragraphs,
      pages: raw.pages,
      needsOCR: raw.needsOCR,
    }),
  );

  const chapterIds = new Set<string>();
  for (const chapter of chapters) {
    if (chapterIds.has(chapter.id)) {
      throw new AppError(ERROR_CODES.INTERNAL, "抽取结果包含重复的章节 ID", {
        status: 500,
      });
    }
    chapterIds.add(chapter.id);
    try {
      validateChapterOffsets(chapter);
    } catch (error) {
      throw new AppError(ERROR_CODES.INTERNAL, "章节段落偏移校验失败", {
        status: 500,
        cause: error,
      });
    }
  }

  const fallbackTitle = deriveTitleFromFilename(filename);
  const book = bookSchema.parse({
    id: bookId,
    title: normalizeTitle(output.title, fallbackTitle),
    author: output.author?.trim()
      ? output.author.trim().slice(0, 200)
      : undefined,
    format: output.format,
    importedAt: new Date().toISOString(),
    chapters: chapters.map((chapter, index) => ({
      id: chapter.id,
      index,
      title: chapter.title,
      charCount: chapter.text.length,
      ...(chapter.pages.length > 0
        ? {
            pageStart: chapter.pages[0].number,
            pageEnd: chapter.pages[chapter.pages.length - 1].number,
          }
        : {}),
    })),
    warnings: output.warnings,
  });

  return { book, chapters, warnings: book.warnings };
}
