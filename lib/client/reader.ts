"use client";

import type { Chapter, PageRange, Paragraph } from "@/lib/schema";

/** Scope of an analysis request triggered from the reader. */
export type ReaderScope = "selection" | "page" | "paragraph" | "chapter";

export interface AnalyzeRequest {
  start: number;
  end: number;
  selectedText: string;
  scope: ReaderScope;
  page?: number;
}

export interface SelectionOffsets {
  start: number;
  end: number;
  text: string;
}

export interface OffsetRange {
  start: number;
  end: number;
  text: string;
}

export interface ParagraphRange extends OffsetRange {
  index: number;
}

export interface PageRangeResult extends OffsetRange {
  page: number;
}

const PARAGRAPH_SELECTOR = "[data-pstart]";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getParagraphElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(PARAGRAPH_SELECTOR),
  );
}

function asElement(node: Node | null): Element | null {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  return node.parentElement;
}

export function closestReaderParagraph(
  container: HTMLElement,
  node: Node | null,
): HTMLElement | null {
  const element = asElement(node);
  const paragraph = element?.closest(PARAGRAPH_SELECTOR);
  if (!paragraph || !container.contains(paragraph)) return null;
  return paragraph as HTMLElement;
}

function readParagraphStart(paragraph: HTMLElement): number | null {
  const raw = paragraph.dataset.pstart;
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Text length from the start of `paragraph` to the `(node, offset)` boundary. */
function getOffsetWithinParagraph(
  paragraph: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  if (!paragraph.contains(node)) return null;
  const range = document.createRange();
  try {
    range.setStart(paragraph, 0);
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

/**
 * Resolve a boundary directly on `container` (e.g. Ctrl+A starts/ends on the
 * article element rather than a text node) to a chapter offset.
 */
function resolveContainerBoundary(
  container: HTMLElement,
  offset: number,
): number | null {
  const paragraphs = getParagraphElements(container);
  if (paragraphs.length === 0) return null;

  if (offset <= 0) return readParagraphStart(paragraphs[0]) ?? 0;

  const children = Array.from(container.childNodes);
  if (offset >= children.length) {
    const last = paragraphs[paragraphs.length - 1];
    const start = readParagraphStart(last);
    return start === null ? null : start + last.textContent.length;
  }

  for (let index = offset; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    const paragraph = element.matches(PARAGRAPH_SELECTOR)
      ? element
      : element.querySelector(PARAGRAPH_SELECTOR);
    if (paragraph instanceof HTMLElement) {
      const start = readParagraphStart(paragraph);
      if (start !== null) return start;
    }
  }

  for (let index = Math.min(offset, children.length) - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    const paragraph = element.matches(PARAGRAPH_SELECTOR)
      ? element
      : element.querySelector(PARAGRAPH_SELECTOR);
    if (paragraph instanceof HTMLElement) {
      const start = readParagraphStart(paragraph);
      if (start !== null) return start + paragraph.textContent.length;
    }
  }

  return null;
}

/**
 * Convert a DOM boundary inside the reader container to a chapter offset using
 * `data-pstart` plus the text length inside that paragraph.
 */
export function getChapterOffsetAtNode(
  container: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  if (typeof document === "undefined") return null;
  if (node === container) return resolveContainerBoundary(container, offset);
  if (!container.contains(node)) return null;

  const paragraph = closestReaderParagraph(container, node);
  if (!paragraph) return null;
  const start = readParagraphStart(paragraph);
  if (start === null) return null;

  const within = getOffsetWithinParagraph(paragraph, node, offset);
  return within === null ? null : start + within;
}

/**
 * Browser-layout helper: resolve a screen point to the paragraph under it.
 * Falls back gracefully when the CaretPosition APIs are unavailable.
 */
export function getParagraphOffsetsAtPoint(
  container: HTMLElement,
  point: { x: number; y: number },
): ParagraphRange | null {
  if (typeof document === "undefined") return null;

  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;

  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(point.x, point.y);
    if (position) {
      node = position.offsetNode;
    }
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(point.x, point.y);
    if (range) {
      node = range.startContainer;
    }
  }

  if (!node) {
    const element =
      typeof doc.elementFromPoint === "function"
        ? doc.elementFromPoint(point.x, point.y)
        : null;
    const paragraph = closestReaderParagraph(container, element);
    if (!paragraph) return null;
    const start = readParagraphStart(paragraph);
    if (start === null) return null;
    const text = paragraph.textContent ?? "";
    return { start, end: start + text.length, text, index: -1 };
  }

  const paragraph = closestReaderParagraph(container, node);
  if (!paragraph) return null;
  const start = readParagraphStart(paragraph);
  if (start === null) return null;
  const text = paragraph.textContent ?? "";
  return { start, end: start + text.length, text, index: -1 };
}

/**
 * Compute the current selection as chapter-relative offsets. Returns `null`
 * when the selection is collapsed, outside the reader, or cannot be mapped to
 * paragraph offsets. Offsets are whitespace-trimmed so `text` never starts or
 * ends with paragraph separators.
 */
export function getSelectionOffsets(
  container: HTMLElement,
  chapterText: string,
): SelectionOffsets | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  if (ancestor !== container && !container.contains(ancestor)) return null;

  const rawStart = getChapterOffsetAtNode(
    container,
    range.startContainer,
    range.startOffset,
  );
  const rawEnd = getChapterOffsetAtNode(
    container,
    range.endContainer,
    range.endOffset,
  );
  if (rawStart === null || rawEnd === null) return null;

  let start = clamp(Math.min(rawStart, rawEnd), 0, chapterText.length);
  let end = clamp(Math.max(rawStart, rawEnd), 0, chapterText.length);

  while (start < end && /\s/.test(chapterText[start] ?? "")) start += 1;
  while (end > start && /\s/.test(chapterText[end - 1] ?? "")) end -= 1;

  if (end <= start) return null;
  return { start, end, text: chapterText.slice(start, end) };
}

/** Paragraph range containing `offset` (inclusive of the paragraph end). */
export function getParagraphRange(
  chapter: Pick<Chapter, "paragraphs">,
  offset: number,
): ParagraphRange | null {
  if (!Number.isFinite(offset)) return null;
  const paragraphs = chapter.paragraphs;
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph: Paragraph = paragraphs[index];
    const end = paragraph.start + paragraph.text.length;
    if (offset >= paragraph.start && offset < end) {
      return { start: paragraph.start, end, text: paragraph.text, index };
    }
  }

  // A caret sitting on a paragraph boundary belongs to that paragraph.
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    const end = paragraph.start + paragraph.text.length;
    if (offset === end) {
      return { start: paragraph.start, end, text: paragraph.text, index };
    }
  }
  return null;
}

export function getPageRange(
  chapter: Pick<Chapter, "pages" | "text">,
  pageNumber: number,
): PageRangeResult | null {
  const page: PageRange | undefined = chapter.pages.find(
    (item) => item.number === pageNumber,
  );
  if (!page) return null;
  const start = clamp(page.start, 0, chapter.text.length);
  const end = clamp(page.end, start, chapter.text.length);
  return {
    start,
    end,
    text: chapter.text.slice(start, end),
    page: page.number,
  };
}

/** Nearest page number for an offset (used to sync the page indicator). */
export function getPageForOffset(
  chapter: Pick<Chapter, "pages">,
  offset: number,
): number | null {
  const pages = chapter.pages;
  if (pages.length === 0) return null;
  for (const page of pages) {
    if (offset >= page.start && offset < page.end) return page.number;
  }
  const last = pages[pages.length - 1];
  if (offset >= last.end) return last.number;
  return pages[0].number;
}
