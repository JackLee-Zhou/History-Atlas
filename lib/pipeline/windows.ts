import {
  CHAPTER_OVERLAP_PARAGRAPHS,
  CHAPTER_WINDOW_CHARS,
  MAX_CHAPTER_WINDOWS,
} from "@/lib/constants";
import type { Chapter } from "@/lib/schema";

export interface ChapterWindow {
  index: number;
  /** Absolute offset in chapter.text. */
  start: number;
  end: number;
  text: string;
}

export interface ChapterWindowsResult {
  windows: ChapterWindow[];
  truncated: boolean;
  /** Total windows that would be needed before the limit. */
  totalWindows: number;
}

interface Span {
  start: number;
  end: number;
}

function paragraphSpans(chapter: Chapter): Span[] {
  const spans: Span[] = [];
  for (const paragraph of chapter.paragraphs) {
    if (!paragraph.text.trim()) continue;
    if (paragraph.start < 0) continue;
    const end = paragraph.start + paragraph.text.length;
    if (end > chapter.text.length) continue;
    if (chapter.text.slice(paragraph.start, end) !== paragraph.text) continue;
    spans.push({ start: paragraph.start, end });
  }
  spans.sort((a, b) => a.start - b.start);

  // Drop fully nested/overlapping spans (corrupt paragraph metadata).
  const deduped: Span[] = [];
  for (const span of spans) {
    const previous = deduped[deduped.length - 1];
    if (previous && span.start < previous.end) continue;
    deduped.push(span);
  }
  if (deduped.length > 0 && deduped[0]!.start === 0) return deduped;

  // Fallback: paragraph metadata missing or does not cover the chapter.
  if (deduped.length > 0) return deduped;
  return [{ start: 0, end: chapter.text.length }];
}

/**
 * Split a chapter into paragraph-aligned windows of roughly 2200 characters,
 * with one overlapping paragraph between neighbours and a hard cap of 12
 * windows. Over-long single paragraphs are chunked without overlap so the
 * window list stays finite.
 */
export function buildChapterWindows(chapter: Chapter): ChapterWindowsResult {
  const text = chapter.text;
  if (!text.trim()) {
    return { windows: [], truncated: false, totalWindows: 0 };
  }

  const spans = paragraphSpans(chapter);
  const raw: Span[] = [];
  let current: Span[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    raw.push({
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
    });
    current = [];
    currentChars = 0;
  };

  for (const span of spans) {
    const length = span.end - span.start;
    if (length > CHAPTER_WINDOW_CHARS) {
      flush();
      for (let offset = 0; offset < length; offset += CHAPTER_WINDOW_CHARS) {
        raw.push({
          start: span.start + offset,
          end: Math.min(span.end, span.start + offset + CHAPTER_WINDOW_CHARS),
        });
      }
      continue;
    }

    if (currentChars > 0 && currentChars + length > CHAPTER_WINDOW_CHARS) {
      const flushed = current;
      flush();
      const last = flushed[flushed.length - 1];
      const overlap =
        CHAPTER_OVERLAP_PARAGRAPHS > 0 && last
          ? last.end - last.start
          : 0;
      if (last && overlap > 0 && overlap + length <= CHAPTER_WINDOW_CHARS) {
        current = [last];
        currentChars = overlap;
      }
    }

    current.push(span);
    currentChars += length;
  }
  flush();

  // Drop duplicate windows that can appear at long-paragraph boundaries.
  const seen = new Set<string>();
  const windows = raw
    .filter((span) => {
      const key = `${span.start}-${span.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return span.end > span.start;
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const limited = windows.slice(0, MAX_CHAPTER_WINDOWS);
  return {
    totalWindows: windows.length,
    truncated: windows.length > MAX_CHAPTER_WINDOWS,
    windows: limited.map((span, index) => ({
      index,
      start: span.start,
      end: span.end,
      text: text.slice(span.start, span.end),
    })),
  };
}
