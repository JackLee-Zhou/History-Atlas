"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import {
  Globe2,
  GripVertical,
  Map as MapIcon,
  PanelRightOpen,
  Settings2,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { ReaderPane } from "@/components/reader/ReaderPane";
import { AtlasWorkspace } from "@/components/atlas";
import { OverviewWorkspace } from "@/components/atlas/overview-workspace";
import type { AtlasSelection } from "@/lib/geo";
import { ModelStatusBadge } from "@/components/workspace/ModelStatusBadge";
import { ReadingBackgroundPicker } from "@/components/theme/ReadingBackgroundPicker";
import { useAnalysisRunner } from "@/components/workspace/useAnalysisRunner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { errorMessage, fetchJson } from "@/lib/client/http";
import { toast } from "sonner";
import type {
  Analysis,
  Book,
  Chapter,
  Citation,
  Overview,
  SettingsView,
} from "@/lib/schema";
import type { AnalyzeRequest } from "@/lib/client/reader";
import { cn } from "@/lib/utils";

type MobileTab = "read" | "atlas";


function featureEvidenceIds(
  analysis: Analysis,
  feature: AtlasSelection,
): string[] {
  const { places, routes, controlAreas, frontLines } = analysis.situation;
  switch (feature.type) {
    case "place":
      return places.find((place) => place.id === feature.id)?.evidence ?? [];
    case "route":
      return routes.find((route) => route.id === feature.id)?.evidence ?? [];
    case "area":
      return controlAreas.find((area) => area.id === feature.id)?.evidence ?? [];
    case "frontline":
      return (
        frontLines.find((line) => line.id === feature.id)?.evidence ?? []
      );
  }
}

function isMobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 1023px)").matches
  );
}

export function WorkspaceClient({
  book,
  chapter,
  initialAnalysis,
}: {
  book: Book;
  chapter: Chapter;
  initialAnalysis: Analysis | null;
}) {
  const router = useRouter();
  const [mobileTab, setMobileTab] = useState<MobileTab>("read");
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [readerRatio, setReaderRatio] = useState(0.52);
  const [atlasCollapsed, setAtlasCollapsed] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [selectedFeature, setSelectedFeature] =
    useState<AtlasSelection | null>(null);
  const [highlight, setHighlight] = useState<{ start: number; end: number } | null>(
    null,
  );
  const autoRanChapterRef = useRef<string | null>(null);
  const lastReadingRangeRef = useRef<{
    start: number;
    end: number;
    paragraphIndex: number;
  } | null>(null);

  useEffect(() => {
    try {
      const savedRatio = Number(
        window.localStorage.getItem("history-atlas.split-ratio"),
      );
      if (Number.isFinite(savedRatio) && savedRatio >= 0.3 && savedRatio <= 0.72) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read of local UI preference
        setReaderRatio(savedRatio);
      }
      setAtlasCollapsed(
        window.localStorage.getItem("history-atlas.atlas-collapsed") === "1",
      );
    } catch {
      // storage is optional
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "history-atlas.split-ratio",
        String(readerRatio),
      );
      window.localStorage.setItem(
        "history-atlas.atlas-collapsed",
        atlasCollapsed ? "1" : "0",
      );
    } catch {
      // storage is optional
    }
  }, [readerRatio, atlasCollapsed]);

  const startResize = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const container = splitRef.current;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;
    const onMove = (moveEvent: PointerEvent) => {
      const minRatio = 0.3;
      const maxRatio = Math.min(0.72, (rect.width - 320) / rect.width);
      const ratio = Math.min(
        Math.max((moveEvent.clientX - rect.left) / rect.width, minRatio),
        Math.max(minRatio, maxRatio),
      );
      setReaderRatio(ratio);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }, []);

  const adjustSplit = useCallback((delta: number) => {
    setReaderRatio((current) =>
      Math.min(0.72, Math.max(0.3, current + delta)),
    );
  }, []);

  const handleResult = useCallback(() => {
    setActiveSceneIndex(0);
    setSelectedFeature(null);
    setHighlight(null);
    if (isMobileViewport()) setMobileTab("atlas");
  }, []);

  const runner = useAnalysisRunner({
    bookId: book.id,
    chapterId: chapter.id,
    initialAnalysis,
    onResult: handleResult,
  });
  const { analysis, busy, restoring, run } = runner;

  const { data: settings } = useSWR<SettingsView>(
    "/api/settings",
    fetchJson,
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "history-atlas.last-read",
        JSON.stringify({ bookId: book.id, chapterId: chapter.id }),
      );
    } catch {
      // localStorage is optional
    }
  }, [book.id, chapter.id]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset on chapter navigation */
  useEffect(() => {
    setOverview(null);
    setOverviewOpen(false);
    setOverviewLoading(false);
    setOverviewError(null);
  }, [book.id, chapter.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const citationById = useMemo(() => {
    const map = new Map<string, Citation>();
    for (const citation of analysis?.situation.citations ?? []) {
      map.set(citation.id, citation);
    }
    return map;
  }, [analysis]);

  const runChapter = useCallback(async () => {
    setOverviewOpen(false);
    await run({
      bookId: book.id,
      chapterId: chapter.id,
      scope: "chapter",
    });
  }, [book.id, chapter.id, run]);

  /* Auto mode: wait until a possible saved analysis has been restored. */
  useEffect(() => {
    if (restoring) return;
    if (!settings?.autoAnalyze) return;
    if (analysis || busy || autoRanChapterRef.current === chapter.id) return;
    autoRanChapterRef.current = chapter.id;
    void runChapter();
  }, [analysis, busy, chapter.id, restoring, runChapter, settings?.autoAnalyze]);

  const loadOverview = useCallback(
    async (refresh = false): Promise<void> => {
      if (settings?.provider === "rule") {
        toast.error("请先在设置页配置模型服务，再生成天下大势。");
        return;
      }
      setOverviewOpen(true);
      setAtlasCollapsed(false);
      setMobileTab("atlas");
      if (!refresh && overview) return;
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        const result = await fetchJson<{ overview: Overview }>(
          "/api/overview",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              bookId: book.id,
              chapterId: chapter.id,
              refresh,
            }),
          },
        );
        setOverview(result.overview);
      } catch (loadError) {
        setOverviewError(errorMessage(loadError));
      } finally {
        setOverviewLoading(false);
      }
    },
    [book.id, chapter.id, overview, settings],
  );

  const toggleOverview = useCallback(() => {
    if (overviewOpen) {
      setOverviewOpen(false);
      return;
    }
    void loadOverview();
  }, [loadOverview, overviewOpen]);

  // The button can attempt generation even before /api/settings resolves;
  // the API returns a clear PROVIDER_NOT_CONFIGURED error when no model is set.
  const canUseOverview = settings?.provider !== "rule";

  const handleAnalyze = useCallback(
    (input: AnalyzeRequest) => {
      void run({
        bookId: book.id,
        chapterId: chapter.id,
        scope: input.scope,
        start: input.start,
        end: input.end,
        selectedText: input.selectedText,
      });
    },
    [book.id, chapter.id, run],
  );

  const handleSelectFeature = useCallback(
    (feature: AtlasSelection | null) => {
      setSelectedFeature(feature);
      if (!feature || !analysis) {
        setHighlight(null);
        return;
      }
      const ids = featureEvidenceIds(analysis, feature);
      const citation = ids
        .map((id) => citationById.get(id))
        .find((item): item is Citation => Boolean(item));
      setHighlight(
        citation ? { start: citation.start, end: citation.end } : null,
      );
    },
    [analysis, citationById],
  );

  const handleReadingPosition = useCallback(
    (range: { start: number; end: number; paragraphIndex: number }) => {
      lastReadingRangeRef.current = range;
      if (!analysis) {
        if (
          settings?.autoAnalyze &&
          !busy &&
          !restoring &&
          autoRanChapterRef.current !== chapter.id
        ) {
          autoRanChapterRef.current = chapter.id;
          void runChapter();
        }
        return;
      }
      const scenes = analysis.situation.scenes;
      if (scenes.length <= 1) return;
      // Overview is the initial state. Without this, a chapter read to the end
      // keeps the last scene when the reader scrolls back to the very top,
      // because the first paragraphs often have no citation to match.
      if (range.start <= 1) {
        setActiveSceneIndex((current) => (current === 0 ? current : 0));
        return;
      }
      if (range.paragraphIndex >= chapter.paragraphs.length - 1) {
        const lastIndex = scenes.length - 1;
        setActiveSceneIndex((current) =>
          current === lastIndex ? current : lastIndex,
        );
        return;
      }
      const places = new Map(
        analysis.situation.places.map((place) => [place.id, place]),
      );
      const routes = new Map(
        analysis.situation.routes.map((route) => [route.id, route]),
      );
      const areas = new Map(
        analysis.situation.controlAreas.map((area) => [area.id, area]),
      );
      const frontLines = new Map(
        analysis.situation.frontLines.map((line) => [line.id, line]),
      );

      const sceneEvidence = scenes.map((scene, index) => {
        const evidenceIds = new Set<string>();
        for (const id of scene.placeIds) {
          for (const evidence of places.get(id)?.evidence ?? []) {
            evidenceIds.add(evidence);
          }
        }
        for (const id of scene.routeIds) {
          for (const evidence of routes.get(id)?.evidence ?? []) {
            evidenceIds.add(evidence);
          }
        }
        for (const id of scene.areaIds) {
          for (const evidence of areas.get(id)?.evidence ?? []) {
            evidenceIds.add(evidence);
          }
        }
        for (const id of scene.frontLineIds) {
          for (const evidence of frontLines.get(id)?.evidence ?? []) {
            evidenceIds.add(evidence);
          }
        }
        return {
          index,
          evidenceIds: [...evidenceIds],
          overview: scene.id === "s-overview" || scene.title.includes("概览"),
        };
      });

      let bestIndex = -1;
      let bestScore = 0;
      let nearestIndex = -1;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const entry of sceneEvidence) {
        if (entry.overview) continue;
        let score = 0;
        for (const evidenceId of entry.evidenceIds) {
          const citation = citationById.get(evidenceId);
          if (!citation) continue;
          if (citation.start < range.end && citation.end > range.start) {
            score +=
              1000 +
              Math.min(citation.end, range.end) -
              Math.max(citation.start, range.start);
            continue;
          }
          const distance =
            citation.start > range.end
              ? citation.start - range.end
              : range.start - citation.end;
          if (distance < 400) score += 400 - distance;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = entry.index;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          bestIndex = entry.index;
        }
      }

      // In the gaps between citation clusters, do not leave the map on the
      // previous scene (that is what made the timeline lag behind the text).
      // Pick the closest scene in text order; top/bottom are handled above.
      if (bestScore === 0 && nearestIndex >= 0 && nearestDistance <= 1500) {
        bestIndex = nearestIndex;
      }

      if (bestIndex >= 0) {
        setActiveSceneIndex((current) =>
          current === bestIndex ? current : bestIndex,
        );
      }
    },
    [
      analysis,
      busy,
      chapter.id,
      chapter.paragraphs.length,
      citationById,
      restoring,
      runChapter,
      settings?.autoAnalyze,
    ],
  );

  // If the user was already reading while the first analysis was generating,
  // align the map to that reading position as soon as the result arrives.
  useEffect(() => {
    if (!analysis || !lastReadingRangeRef.current) return;
    const timer = window.setTimeout(() => {
      if (lastReadingRangeRef.current) {
        handleReadingPosition(lastReadingRangeRef.current);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [analysis, handleReadingPosition]);

  const chapterOptions = book.chapters.map((item) => ({
    id: item.id,
    title: item.title,
  }));
  const chapterPosition = book.chapters.findIndex(
    (item) => item.id === chapter.id,
  );
  const previousChapter =
    chapterPosition > 0 ? book.chapters[chapterPosition - 1] : undefined;
  const nextChapter =
    chapterPosition >= 0 && chapterPosition < book.chapters.length - 1
      ? book.chapters[chapterPosition + 1]
      : undefined;

  const emptyAtlas = (
    <div className="paper-panel flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-sm px-6 py-16 text-center">
      <span className="seal h-12 w-12 text-xl">
        <MapIcon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <h2 className="font-serif text-xl">尚未生成态势</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-ink-soft">
          在左侧选中一段原文后点“还原态势”，或用右上角“整章态势”生成。每个地点和箭头都会对应到原文证据。
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          className="lg:hidden"
          onClick={() => setMobileTab("read")}
        >
          去阅读器选段
        </Button>
      </div>
      <p className="max-w-md text-[11px] leading-5 text-ink-faint">
        没有 API key 时，规则模式只标注可识别地名；配置模型后才能生成势力、路线与叙述。
      </p>
    </div>
  );

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <AppHeader
        title={book.title}
        subtitle={chapter.title}
        eyebrow={`${book.format.toUpperCase()} · ${book.author ?? "佚名"}`}
        backHref="/"
        right={
          <>
            <ModelStatusBadge className="hidden sm:block" />
            <Link className="icon-btn" href="/settings" aria-label="设置">
              <Settings2 className="h-4 w-4" />
            </Link>
          </>
        }
      />

      <div className="workspace-ribbon flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hidden shrink-0 text-[10px] tracking-[0.18em] text-ink-faint sm:inline">
            章节
          </span>
          <Select
            className="max-w-[18rem] text-xs"
            value={chapter.id}
            onChange={(event) => {
              const next = event.target.value;
              if (next !== chapter.id) {
                router.push(`/book/${book.id}/${next}`);
              }
            }}
            aria-label="切换章节"
          >
            {chapterOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </Select>
          <span className="hidden text-[11px] text-ink-faint md:inline">
            {chapter.text.length.toLocaleString("zh-CN")} 字
            {chapter.pages.length > 0 ? ` · ${chapter.pages.length} 页` : ""}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="mr-1 flex gap-1 lg:hidden" role="tablist" aria-label="工作区视图">
            {(
              [
                ["read", "阅读"],
                ["atlas", "舆图"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={mobileTab === key ? "primary" : "outline"}
                onClick={() => setMobileTab(key)}
                aria-pressed={mobileTab === key}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant={overviewOpen ? "primary" : "outline"}
            onClick={toggleOverview}
            disabled={!canUseOverview || overviewLoading || chapter.text.length === 0}
            aria-label="天下大势"
            aria-pressed={overviewOpen}
            title={
              canUseOverview
                ? "按当前章节年代推演全国省域大势"
                : "配置模型服务后可用"
            }
          >
            {overviewLoading ? (
              <Globe2 className="h-4 w-4 animate-pulse" aria-hidden />
            ) : (
              <Globe2 className="h-4 w-4" aria-hidden />
            )}
            <span className="hidden sm:inline">天下大势</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runChapter()}
            disabled={busy || chapter.text.length === 0}
          >
            <MapIcon className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">整章态势</span>
          </Button>
          <ReadingBackgroundPicker />
        </div>
      </div>

      <div
        ref={splitRef}
        className="relative flex min-h-0 flex-1 flex-col lg:flex-row"
        style={{ "--reader-width": `${readerRatio * 100}%` } as CSSProperties}
      >

        <section
          className={cn(
            "min-h-0",
            mobileTab === "read" ? "block" : "hidden",
            "lg:block",
            atlasCollapsed
              ? "lg:w-full lg:flex-1"
              : "lg:w-[var(--reader-width)] lg:flex-none",
          )}
          aria-label="阅读区"
        >
          <ReaderPane
            chapter={chapter}
            bookTitle={book.title}
            previousChapter={previousChapter}
            nextChapter={nextChapter}
            onNavigateChapter={(chapterId) =>
              router.push(`/book/${book.id}/${chapterId}`)
            }
            onReadingPositionChange={handleReadingPosition}
            highlight={highlight}
            onAnalyze={handleAnalyze}
            busy={busy}
            className="h-full"
          />
        </section>

        {!atlasCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整阅读器与舆图宽度"
            aria-valuemin={30}
            aria-valuemax={72}
            aria-valuenow={Math.round(readerRatio * 100)}
            aria-valuetext={`阅读器 ${Math.round(readerRatio * 100)}%`}
            tabIndex={0}
            className="group hidden w-1.5 shrink-0 cursor-col-resize items-center justify-center border-x border-line/40 bg-paper-deep/40 transition-colors hover:bg-cinnabar/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar/40 lg:flex"
            onPointerDown={startResize}
            onDoubleClick={() => setReaderRatio(0.52)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                adjustSplit(-0.02);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                adjustSplit(0.02);
              } else if (event.key === "Home") {
                event.preventDefault();
                setReaderRatio(0.3);
              } else if (event.key === "End") {
                event.preventDefault();
                setReaderRatio(0.72);
              }
            }}
            title="拖动调整宽度；双击恢复默认；方向键细调"
          >
            <GripVertical
              className="h-4 w-4 text-ink-faint/50 group-hover:text-cinnabar"
              aria-hidden
            />
          </div>
        ) : null}

        <section
          className={cn(
            "scrollbar-thin flex min-h-0 flex-col overflow-y-auto p-3 sm:p-4 lg:overflow-hidden",
            mobileTab === "atlas" ? "flex" : "hidden",
            atlasCollapsed ? "lg:hidden" : "lg:flex lg:flex-1",
          )}
          aria-label="舆图区"
        >
          {analysis ? (
            <AtlasWorkspace
              analysis={analysis}
              activeSceneIndex={activeSceneIndex}
              onSceneChange={setActiveSceneIndex}
              selectedFeature={selectedFeature}
              onSelectFeature={handleSelectFeature}
              onCollapse={() => setAtlasCollapsed(true)}
              className="h-full min-h-0"
            />
          ) : (
            emptyAtlas
          )}
        </section>

      </div>

      {atlasCollapsed ? (
        <button
          type="button"
          onClick={() => setAtlasCollapsed(false)}
          className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 items-center gap-1 rounded-l-sm border border-r-0 border-line/70 bg-surface/95 px-1.5 py-3 text-[10px] tracking-[0.12em] text-ink-soft shadow-sm transition-colors hover:bg-surface-soft hover:text-cinnabar lg:flex"
          aria-label="展开舆图"
          title="展开舆图"
        >
          <PanelRightOpen className="h-4 w-4" aria-hidden />
          <span style={{ writingMode: "vertical-rl" }}>舆图</span>
        </button>
      ) : null}

      {overviewOpen ? (
        <div className="overview-overlay">
          <OverviewWorkspace
            overview={overview}
            loading={overviewLoading}
            error={overviewError}
            onClose={() => setOverviewOpen(false)}
            onRetry={() => void loadOverview(true)}
          />
        </div>
      ) : null}

    </main>
  );
}
