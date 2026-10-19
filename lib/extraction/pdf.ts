import type { PDFDocumentProxy } from "pdfjs-dist";

import type { PageRange, Warning } from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";

import {
  createChapterContentBuilder,
  deriveTitleFromFilename,
  normalizeParagraphText,
  normalizeTitle,
} from "./content";
import type { ExtractionOutput, RawChapter } from "./types";
import { extractionWarning } from "./warnings";

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

interface OutlineEntry {
  title: string;
  page: number;
}

interface ChapterDef {
  title: string;
  pageStart: number;
  pageEnd: number;
}

const SENTENCE_END = /[。！？；：!?;:.…”」』）)】》]$/;
const MAX_PDF_PAGES = 1200;
const SPARSE_PAGE_CHARS = 20;

function needsSpace(previous: string, next: string): boolean {
  if (!previous || !next) return false;
  const left = previous[previous.length - 1];
  const right = next[0];
  if (/\s/.test(left) || /\s/.test(right)) return false;
  return /[A-Za-z0-9]/.test(left) && /[A-Za-z0-9]/.test(right);
}

/**
 * Convert positioned PDF text fragments into visual lines. CJK fragments are
 * concatenated without spaces; Latin word fragments get a space only when both
 * sides are alphanumeric.
 */
function textLinesFromItems(items: readonly unknown[]): string[] {
  const lines: string[] = [];
  let current = "";
  let previous = "";

  const pushLine = (): void => {
    if (current.trim()) lines.push(current);
    current = "";
    previous = "";
  };

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || !("str" in raw)) continue;
    const item = raw as { str: string; hasEOL?: boolean };
    if (!item.str) {
      if (item.hasEOL) pushLine();
      continue;
    }
    if (current && needsSpace(previous, item.str)) current += " ";
    current += item.str;
    previous = item.str;
    if (item.hasEOL) pushLine();
  }
  pushLine();
  return lines;
}

/** Merge visual lines into paragraphs, breaking on sentence punctuation. */
function linesToParagraphs(lines: string[]): string[] {
  const output: string[] = [];
  let buffer = "";

  const flush = (): void => {
    const text = normalizeParagraphText(buffer);
    if (text) output.push(text);
    buffer = "";
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) {
      flush();
      continue;
    }
    if (!buffer) {
      buffer = line;
    } else if (SENTENCE_END.test(buffer)) {
      flush();
      buffer = line;
    } else if (needsSpace(buffer, line)) {
      buffer += ` ${line}`;
    } else {
      buffer += line;
    }
    if (SENTENCE_END.test(buffer)) flush();
  }
  flush();
  return output;
}

async function resolveDestPage(
  pdf: PDFDocumentProxy,
  dest: OutlineNode["dest"],
): Promise<number | null> {
  try {
    let explicit: unknown = dest;
    if (typeof dest === "string") {
      explicit = await pdf.getDestination(dest);
    }
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const first = explicit[0];
    if (typeof first === "number") return first + 1;
    if (first && typeof first === "object" && "num" in first) {
      const index = await pdf.getPageIndex(
        first as { num: number; gen: number },
      );
      return index + 1;
    }
    return null;
  } catch {
    return null;
  }
}

async function collectOutlineEntries(
  pdf: PDFDocumentProxy,
  nodes: OutlineNode[],
  depth = 0,
): Promise<OutlineEntry[]> {
  if (depth > 3) return [];
  const entries: OutlineEntry[] = [];
  for (const node of nodes) {
    const title = normalizeParagraphText(node.title ?? "");
    const page = await resolveDestPage(pdf, node.dest);
    if (title && page !== null) entries.push({ title, page });
    const children = Array.isArray(node.items)
      ? (node.items as OutlineNode[])
      : [];
    if (children.length > 0) {
      entries.push(...(await collectOutlineEntries(pdf, children, depth + 1)));
    }
  }
  return entries;
}

function buildChapterDefs(
  entries: OutlineEntry[],
  numPages: number,
): ChapterDef[] {
  const valid = entries
    .filter((entry) => entry.page >= 1 && entry.page <= numPages)
    .sort((left, right) => left.page - right.page);

  const seen = new Set<number>();
  const starts: OutlineEntry[] = [];
  for (const entry of valid) {
    if (seen.has(entry.page)) continue;
    seen.add(entry.page);
    starts.push(entry);
  }

  if (starts.length === 0) {
    return [{ title: "全文", pageStart: 1, pageEnd: numPages }];
  }
  if (starts[0].page > 1) {
    starts.unshift({ title: "卷首", page: 1 });
  }

  const defs: ChapterDef[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const pageStart = starts[index].page;
    const pageEnd =
      index + 1 < starts.length ? starts[index + 1].page - 1 : numPages;
    if (pageEnd < pageStart) continue;
    defs.push({ title: starts[index].title, pageStart, pageEnd });
  }
  return defs;
}

function toPdfAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") {
    return new AppError(ERROR_CODES.NO_TEXT_LAYER, "PDF 已加密，无法提取文本", {
      status: 422,
      cause: error,
    });
  }
  if (name === "InvalidPDFException") {
    return new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "PDF 文件损坏或格式不受支持",
      { status: 415, cause: error },
    );
  }
  return new AppError(
    ERROR_CODES.NO_TEXT_LAYER,
    "无法从 PDF 提取文本层，文件可能损坏或为扫描件",
    { status: 422, cause: error },
  );
}

async function extractFromDocument(
  pdf: PDFDocumentProxy,
  input: { filename: string; title?: string },
): Promise<ExtractionOutput> {
  if (pdf.numPages < 1) {
    throw new AppError(ERROR_CODES.NO_TEXT_LAYER, "PDF 没有可读取的页面", {
      status: 422,
    });
  }
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new AppError(
      ERROR_CODES.IMPORT_TOO_LARGE,
      `PDF 页数超过 ${MAX_PDF_PAGES} 页安全上限`,
      { status: 413 },
    );
  }

  const warnings: Warning[] = [];
  const pageLines: string[][] = [];
  let totalChars = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = textLinesFromItems(content.items);
    pageLines.push(lines);
    totalChars += lines.reduce((sum, line) => sum + line.length, 0);
  }

  if (totalChars === 0) {
    throw new AppError(
      ERROR_CODES.NO_TEXT_LAYER,
      "PDF 没有可提取的文本层，请先 OCR 或上传文本版",
      { status: 422 },
    );
  }

  const needsOCR = totalChars / pdf.numPages < SPARSE_PAGE_CHARS;
  if (needsOCR) {
    warnings.push(
      extractionWarning(
        "PDF_NEEDS_OCR",
        "PDF 文本层稀疏（平均每页不足 20 字），可能是扫描件，建议先 OCR",
        "warning",
      ),
    );
  }

  const outline = await pdf.getOutline().catch(() => null);
  const outlineEntries = outline
    ? await collectOutlineEntries(pdf, outline)
    : [];
  if (outlineEntries.length === 0) {
    warnings.push(
      extractionWarning(
        "PDF_NO_OUTLINE",
        "PDF 未提供可用目录，已按整本一章处理",
        "info",
      ),
    );
  }

  const defs = buildChapterDefs(outlineEntries, pdf.numPages);
  const chapters: RawChapter[] = [];

  for (const def of defs) {
    const builder = createChapterContentBuilder();
    const pages: PageRange[] = [];

    for (
      let pageNumber = def.pageStart;
      pageNumber <= def.pageEnd;
      pageNumber += 1
    ) {
      const beforeCount = builder.paragraphs.length;
      const beforeLength = builder.length;
      for (const paragraph of linesToParagraphs(
        pageLines[pageNumber - 1] ?? [],
      )) {
        builder.add(paragraph);
      }
      const added = builder.paragraphs.length > beforeCount;
      const last = builder.paragraphs[builder.paragraphs.length - 1];
      const start = added ? builder.paragraphs[beforeCount].start : beforeLength;
      const end = added && last ? last.start + last.text.length : beforeLength;
      pages.push({ number: pageNumber, start, end });
    }

    const content = builder.finish();
    if (!content.text) continue;

    const fallbackTitle = `第 ${chapters.length + 1} 章`;
    chapters.push({
      id: `ch-${chapters.length + 1}`,
      title: normalizeTitle(def.title, fallbackTitle),
      text: content.text,
      paragraphs: content.paragraphs,
      pages,
      needsOCR,
    });
  }

  if (chapters.length === 0) {
    throw new AppError(
      ERROR_CODES.NO_TEXT_LAYER,
      "PDF 没有可提取的正文文本",
      { status: 422 },
    );
  }

  const fallbackTitle = deriveTitleFromFilename(input.filename);
  const bookTitle = normalizeTitle(
    input.title?.trim() || fallbackTitle,
    fallbackTitle,
  );

  return {
    format: "pdf",
    title: bookTitle,
    chapters,
    warnings,
  };
}

/**
 * PDF text-layer extraction using the pdfjs-dist legacy build. Chapters follow
 * the PDF outline when present; otherwise the whole document is one chapter.
 * Scanned PDFs (sparse text) are surfaced with `needsOCR` + a warning.
 */
export async function extractPdf(input: {
  buffer: Uint8Array;
  filename: string;
  title?: string;
}): Promise<ExtractionOutput> {
  let pdfjs: PdfJsModule;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    throw new AppError(
      ERROR_CODES.NO_TEXT_LAYER,
      "PDF 解析库加载失败，请检查服务端依赖",
      { status: 500, cause: error },
    );
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(input.buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]);

  try {
    const pdf = await loadingTask.promise;
    return await extractFromDocument(pdf, input);
  } catch (error) {
    throw toPdfAppError(error);
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      // Worker teardown is best-effort; extraction result is already settled.
    }
  }
}
