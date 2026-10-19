"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Map as MapIcon,
  Quote,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  getPageForOffset,
  getPageRange,
  getParagraphRange,
  getSelectionOffsets,
  type AnalyzeRequest,
  type SelectionOffsets,
} from "@/lib/client/reader";
import type { Chapter, PageRange, Paragraph } from "@/lib/schema";
import { cn } from "@/lib/utils";

type ReaderFontSize = "sm" | "md" | "lg";

const FONT_STORAGE_KEY = "history-atlas.reader.font-size";
const FONT_OPTIONS: Record<
  ReaderFontSize,
  { label: string; fontSize: string; lineHeight: number }
> = {
  sm: { label: "小", fontSize: "0.98rem", lineHeight: 1.95 },
  md: { label: "中", fontSize: "1.08rem", lineHeight: 2.05 },
  lg: { label: "大", fontSize: "1.22rem", lineHeight: 2.1 },
};

export interface ReaderPaneProps {
  chapter: Chapter;
  bookTitle?: string;
  highlight?: { start: number; end: number } | null;
  currentPage?: number;
  onAnalyze(input: AnalyzeRequest): void;
  busy?: boolean;
  className?: string;
  previousChapter?: { id: string; title: string };
  nextChapter?: { id: string; title: string };
  onNavigateChapter?(chapterId: string): void;
  /** Fires when the paragraph at the top of the reading viewport changes. */
  onReadingPositionChange?(range: {
    start: number;
    end: number;
    paragraphIndex: number;
  }): void;
}

function paragraphIsHighlighted(
  paragraph: Paragraph,
  highlight?: { start: number; end: number } | null,
): boolean {
  if (!highlight) return false;
  const paragraphEnd = paragraph.start + paragraph.text.length;
  if (highlight.end <= highlight.start) {
    return highlight.start >= paragraph.start && highlight.start <= paragraphEnd;
  }
  return paragraph.start < highlight.end && highlight.start < paragraphEnd;
}

function PageMarker({
  page,
  active,
  busy,
  onAnalyzePage,
}: {
  page: PageRange;
  active: boolean;
  busy: boolean;
  onAnalyzePage: (pageNumber: number) => void;
}) {
  const isEmpty = page.end <= page.start;
  return (
    <div
      data-page-marker={page.number}
      data-active-page={active ? "true" : undefined}
      role="separator"
      aria-label={`第 ${page.number} 页`}
      className={cn("reader-page-marker", active && "text-cinnabar")}
    >
      <span className="shrink-0 tracking-[0.16em]">
        · 第 {page.number} 页{active ? " · 当前" : ""} ·
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="min-h-7! px-2! text-[11px]"
        onClick={() => onAnalyzePage(page.number)}
        disabled={busy || isEmpty}
        aria-label={`分析第 ${page.number} 页态势`}
      >
        <MapIcon className="h-3.5 w-3.5" aria-hidden />
        本页态势
      </Button>
    </div>
  );
}

/**
 * Clean, self-owned reader rendering. It renders extracted paragraph text
 * (never the original XHTML) and reports selection/page/paragraph/chapter ranges
 * as chapter-relative offsets. It never fetches: the parent owns all API calls.
 */
export function ReaderPane({
  chapter,
  bookTitle,
  highlight,
  currentPage,
  onAnalyze,
  busy = false,
  className,
  previousChapter,
  nextChapter,
  onNavigateChapter,
  onReadingPositionChange,
}: ReaderPaneProps) {
  const contentRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const readingPositionRef = useRef(onReadingPositionChange);
  const [selectionState, setSelectionState] = useState<{
    chapterId: string;
    offsets: SelectionOffsets;
  } | null>(null);
  const [fontSize, setFontSize] = useState<ReaderFontSize>("md");

  // Ignore stale selections from the previous chapter without an effect.
  const selection =
    selectionState?.chapterId === chapter.id ? selectionState.offsets : null;

  const highlightStart = highlight?.start ?? null;
  const highlightEnd = highlight?.end ?? null;

  /* Font size persists locally; read after mount to avoid hydration mismatch. */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
      if (stored === "sm" || stored === "md" || stored === "lg") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR; reading it after mount avoids a hydration mismatch.
        setFontSize(stored);
      }
    } catch {
      // Storage can be disabled; the default size is fine.
    }
  }, []);

  const changeFontSize = useCallback((value: ReaderFontSize) => {
    setFontSize(value);
    try {
      window.localStorage.setItem(FONT_STORAGE_KEY, value);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  /* Track text selection anywhere in the document, but only inside this pane. */
  const syncSelection = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;
    const offsets = getSelectionOffsets(container, chapter.text);
    setSelectionState(
      offsets ? { chapterId: chapter.id, offsets } : null,
    );
  }, [chapter.id, chapter.text]);

  useEffect(() => {
    document.addEventListener("selectionchange", syncSelection);
    return () => document.removeEventListener("selectionchange", syncSelection);
  }, [syncSelection]);

  /* Scroll the first highlighted paragraph into view when a citation arrives. */
  useEffect(() => {
    if (
      highlightStart === null ||
      highlightEnd === null ||
      highlightEnd <= highlightStart
    ) {
      return;
    }
    const container = contentRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      '[data-highlighted="true"]',
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [chapter.id, highlightStart, highlightEnd]);

  /* Keep the requested page visible unless a citation highlight wins. */
  useEffect(() => {
    const hasHighlight =
      highlightStart !== null &&
      highlightEnd !== null &&
      highlightEnd > highlightStart;
    if (currentPage === undefined || hasHighlight) {
      return;
    }
    const container = contentRef.current;
    if (!container) return;
    const marker = container.querySelector<HTMLElement>(
      `[data-page-marker="${currentPage}"]`,
    );
    marker?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [chapter.id, currentPage, highlightStart, highlightEnd]);

  const pageMarkers = useMemo(() => {
    const markers = new Map<number, PageRange[]>();
    if (chapter.pages.length === 0) return markers;
    for (const page of chapter.pages) {
      let index = chapter.paragraphs.findIndex(
        (paragraph) => paragraph.start >= page.start,
      );
      if (index < 0) index = chapter.paragraphs.length;
      const existing = markers.get(index);
      if (existing) existing.push(page);
      else markers.set(index, [page]);
    }
    return markers;
  }, [chapter.pages, chapter.paragraphs]);

  const paragraphScope = selection
    ? getParagraphRange(chapter, selection.start)
    : null;
  const singleParagraph = Boolean(
    selection && paragraphScope && selection.end <= paragraphScope.end,
  );
  const selectionPage = selection
    ? getPageForOffset(chapter, selection.start)
    : null;

  const handleAnalyzeSelection = (): void => {
    if (busy || !selection) return;
    onAnalyze({
      start: selection.start,
      end: selection.end,
      selectedText: selection.text,
      scope: "selection",
      ...(selectionPage !== null ? { page: selectionPage } : {}),
    });
  };

  const handleAnalyzeParagraph = (): void => {
    if (busy || !paragraphScope) return;
    onAnalyze({
      start: paragraphScope.start,
      end: paragraphScope.end,
      selectedText: paragraphScope.text,
      scope: "paragraph",
      ...(selectionPage !== null ? { page: selectionPage } : {}),
    });
  };

  const handleAnalyzePage = (pageNumber: number): void => {
    if (busy) return;
    const range = getPageRange(chapter, pageNumber);
    if (!range || range.end <= range.start) return;
    onAnalyze({
      start: range.start,
      end: range.end,
      selectedText: range.text,
      scope: "page",
      page: range.page,
    });
  };

  const clearSelection = (): void => {
    setSelectionState(null);
    window.getSelection()?.removeAllRanges();
  };

  useEffect(() => {
    readingPositionRef.current = onReadingPositionChange;
  }, [onReadingPositionChange]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const emit = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const article = contentRef.current;
        if (!article) return;
        const top = container.getBoundingClientRect().top + 72;
        let chosen: HTMLElement | null = null;
        for (const element of article.querySelectorAll<HTMLElement>(
          "[data-pstart]",
        )) {
          if (element.getBoundingClientRect().bottom >= top) {
            chosen = element;
            break;
          }
        }
        if (!chosen) return;
        const start = Number(chosen.dataset.pstart);
        if (!Number.isFinite(start)) return;
        readingPositionRef.current?.({
          start,
          end: start + (chosen.textContent?.length ?? 0),
          paragraphIndex: Number(chosen.dataset.paragraphIndex ?? 0),
        });
      });
    };
    container.addEventListener("scroll", emit, { passive: true });
    return () => {
      container.removeEventListener("scroll", emit);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [chapter.id]);

  const font = FONT_OPTIONS[fontSize];
  const hasDropcap = /^[\u3400-\u9fff]/.test(
    chapter.paragraphs[0]?.text.trimStart() ?? "",
  );

  return (
    <section
      className={cn("relative flex h-full min-h-0 flex-col", className)}
      aria-label="阅读器"
      aria-busy={busy || undefined}
    >
      <div ref={scrollRef} className="reader-scroll min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="reader-sheet">
          <span className="reader-sheet__ribbon" aria-hidden />
          <header className="reader-masthead">
            <p className="reader-runhead">
              {bookTitle ? `${bookTitle} · 阅读室` : "史地舆图 · 阅读室"}
            </p>
            <h2 className="reader-chapter-title">{chapter.title}</h2>
            <p className="reader-chapter-sub">
              {chapter.text.length.toLocaleString("zh-CN")} 字
              {chapter.pages.length > 0
                ? ` · ${chapter.pages.length} 页`
                : ""}
              {chapter.needsOCR ? " · 文本层稀疏，可能需 OCR" : ""}
            </p>
            <div className="reader-rule" aria-hidden>
              <span />
            </div>
            <div className="reader-controls">
              <span className="mr-1">字号</span>
              {(Object.keys(FONT_OPTIONS) as ReaderFontSize[]).map((size) => (
                <Button
                  key={size}
                  size="sm"
                  variant={fontSize === size ? "primary" : "outline"}
                  onClick={() => changeFontSize(size)}
                  aria-label={`字号：${FONT_OPTIONS[size].label}`}
                  aria-pressed={fontSize === size}
                >
                  {FONT_OPTIONS[size].label}
                </Button>
              ))}
            </div>
          </header>

          {chapter.paragraphs.length === 0 ? (
            <div className="paper-panel mt-6 rounded-sm p-6 text-sm leading-7 text-ink-soft">
              <p className="font-serif text-base text-ink">
                {chapter.needsOCR
                  ? "这一章没有可提取的文字"
                  : "本章没有可读正文"}
              </p>
              <p className="mt-2">
                {chapter.needsOCR
                  ? "这份 PDF 可能是扫描件，文本层过少。可以先用 OCR 工具生成文本版，再重新导入。"
                  : "可以返回书库选择其他章节，或重新导入内容完整的文件。"}
              </p>
            </div>
          ) : (
            <article
              ref={contentRef}
              tabIndex={0}
              className={cn(
                "reader-text focus:outline-none",
                hasDropcap && "reader-text--dropcap",
              )}
              style={{ fontSize: font.fontSize, lineHeight: font.lineHeight }}
              aria-label={`${chapter.title}正文`}
            >
              {chapter.paragraphs.map((paragraph, index) => {
                const markers = pageMarkers.get(index) ?? [];
                const highlighted = paragraphIsHighlighted(paragraph, highlight);
                return (
                  <Fragment key={paragraph.start}>
                    {markers.map((page) => (
                      <PageMarker
                        key={page.number}
                        page={page}
                        active={currentPage === page.number}
                        busy={busy}
                        onAnalyzePage={handleAnalyzePage}
                      />
                    ))}
                    <p
                      data-pstart={paragraph.start}
                      data-paragraph-index={index}
                      data-highlighted={highlighted ? "true" : undefined}
                      className={cn(
                        highlighted && "reader-paragraph-highlight",
                      )}
                    >
                      {paragraph.text}
                    </p>
                  </Fragment>
                );
              })}
              {(pageMarkers.get(chapter.paragraphs.length) ?? []).map((page) => (
                <PageMarker
                  key={page.number}
                  page={page}
                  active={currentPage === page.number}
                  busy={busy}
                  onAnalyzePage={handleAnalyzePage}
                />
              ))}
            </article>
          )}

          <div className="reader-colophon">
            <span className="reader-colophon__mark">史地舆图 · 藏本</span>
            <span>
              {chapter.text.length.toLocaleString("zh-CN")} 字 · 原文可追溯
            </span>
          </div>

          {onNavigateChapter ? (
            <nav className="reader-chapter-nav" aria-label="章节导航">
              <button
                type="button"
                disabled={!previousChapter}
                onClick={() =>
                  previousChapter && onNavigateChapter(previousChapter.id)
                }
                aria-label={
                  previousChapter
                    ? `上一章：${previousChapter.title}`
                    : "没有上一章"
                }
              >
                <ChevronLeft className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
                <span className="reader-chapter-nav__eyebrow">上一章</span>
                <span className="reader-chapter-nav__title">
                  {previousChapter?.title ?? "已经是第一章"}
                </span>
              </button>
              <button
                type="button"
                disabled={!nextChapter}
                onClick={() => nextChapter && onNavigateChapter(nextChapter.id)}
                aria-label={nextChapter ? `下一章：${nextChapter.title}` : "没有下一章"}
              >
                <span className="reader-chapter-nav__eyebrow">下一章</span>
                <span className="reader-chapter-nav__title">
                  {nextChapter?.title ?? "已经是最后一章"}
                </span>
                <ChevronRight className="ml-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
              </button>
            </nav>
          ) : null}
        </div>
      </div>

      {selection ? (
        <div
          className="reader-selection z-30 fixed inset-x-0 bottom-0 px-4 py-3 backdrop-blur sm:static sm:inset-auto sm:shrink-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:backdrop-blur-none"
          role="region"
          aria-label="阅读操作"
        >
          <div className="reader-selection__inner mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 px-0 py-0 sm:px-6 sm:py-3">
            <p
              className="mr-auto text-xs text-ink-soft"
              role="status"
              aria-live="polite"
            >
              已选 {selection.end - selection.start} 字
              {selectionPage !== null ? ` · 第 ${selectionPage} 页` : ""}
            </p>
            <Button
              size="sm"
              variant="primary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleAnalyzeSelection}
              disabled={busy}
              aria-label="还原选区态势"
            >
              <MapIcon className="h-4 w-4" aria-hidden />
              还原态势
            </Button>
            {singleParagraph ? (
              <Button
                size="sm"
                variant="outline"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleAnalyzeParagraph}
                disabled={busy}
                aria-label="还原本段态势"
              >
                <Quote className="h-3.5 w-3.5" aria-hidden />
                本段态势
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearSelection}
              aria-label="取消选区"
            >
              <X className="h-4 w-4" aria-hidden />
              取消
            </Button>
          </div>
        </div>
      ) : null}

    </section>
  );
}
