"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  getScene,
  sceneAreas,
  sceneFrontLines,
  scenePlaces,
  sceneRoutes,
} from "@/lib/geo";
import type { AtlasSelection } from "@/lib/geo";
import type { Analysis } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { AtlasMap } from "./atlas-map";
import {
  EvidencePanel,
  SelectionDetail,
  SituationPanel,
  UnresolvedPanel,
} from "./atlas-panels";
import { resolveSelection } from "./selection";
import { AtlasTimeline } from "./timeline";

export interface AtlasWorkspaceProps {
  analysis: Analysis;
  activeSceneIndex: number;
  onSceneChange(index: number): void;
  selectedFeature: AtlasSelection | null;
  onSelectFeature(feature: AtlasSelection | null): void;
  correctingPlaceId?: string | null;
  onCorrectLocation?(input: {
    placeId: string;
    lng: number;
    lat: number;
  }): void;
  onCancelCorrection?(): void;
  onCollapse?(): void;
  className?: string;
  /**
   * Optional integration hook: when provided, the parent owns correction mode
   * (set `correctingPlaceId`). Without it the workspace manages a local mode.
   */
  onBeginCorrection?(placeId: string): void;
}

export function AtlasWorkspace({
  analysis,
  activeSceneIndex,
  onSceneChange,
  selectedFeature,
  onSelectFeature,
  correctingPlaceId,
  onCorrectLocation,
  onCancelCorrection,
  onCollapse,
  className,
  onBeginCorrection,
}: AtlasWorkspaceProps) {
  const [panelTab, setPanelTab] = useState("summary");
  const [localCorrectingPlaceId, setLocalCorrectingPlaceId] = useState<
    string | null
  >(null);
  const [detailCollapsed, setDetailCollapsed] = useState(true);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe local preference
      setDetailCollapsed(
        window.localStorage.getItem("history-atlas.detail-collapsed-v2") !==
          "0",
      );
    } catch {
      // storage is optional
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "history-atlas.detail-collapsed-v2",
        detailCollapsed ? "1" : "0",
      );
    } catch {
      // storage is optional
    }
  }, [detailCollapsed]);

  const scenes = analysis.situation.scenes;
  const scene = useMemo(
    () => getScene(analysis, activeSceneIndex),
    [analysis, activeSceneIndex],
  );
  const places = useMemo(() => scenePlaces(analysis, scene), [analysis, scene]);
  const routes = useMemo(
    () => sceneRoutes(analysis, scene),
    [analysis, scene],
  );
  const areas = useMemo(() => sceneAreas(analysis, scene), [analysis, scene]);
  const frontLines = useMemo(
    () => sceneFrontLines(analysis, scene),
    [analysis, scene],
  );
  const unresolved = useMemo(
    () => analysis.situation.places.filter((place) => !place.location),
    [analysis.situation.places],
  );
  const resolvedSelection = useMemo(
    () => resolveSelection(analysis, selectedFeature),
    [analysis, selectedFeature],
  );
  const hasApproximatePlaces =
    analysis.situation.places.some((place) => Boolean(place.locationNote)) ||
    analysis.meta.warnings.some(
      (item) =>
        item.code === "APPROXIMATE_OVERVIEW" ||
        item.code === "LOCATION_APPROXIMATED",
    );
  const scenePosition = scene
    ? scenes.findIndex((item) => item.id === scene.id)
    : -1;

  const effectiveCorrectingPlaceId =
    correctingPlaceId ?? localCorrectingPlaceId;
  const canCorrect = Boolean(onCorrectLocation);
  const correctingPlace = effectiveCorrectingPlaceId
    ? analysis.situation.places.find(
        (place) => place.id === effectiveCorrectingPlaceId,
      )
    : null;
  const beginCorrection = useCallback(
    (placeId: string) => {
      if (!onCorrectLocation) return;
      onBeginCorrection?.(placeId);
      if (!onBeginCorrection) {
        setLocalCorrectingPlaceId(placeId);
      }
    },
    [onBeginCorrection, onCorrectLocation],
  );

  const handleMapCorrectLocation = useCallback(
    (input: { placeId: string; lng: number; lat: number }) => {
      onCorrectLocation?.(input);
      setLocalCorrectingPlaceId(null);
    },
    [onCorrectLocation],
  );

  const cancelCorrection = useCallback(() => {
    setLocalCorrectingPlaceId(null);
    onCancelCorrection?.();
  }, [onCancelCorrection]);

  const handleUseCandidate = useCallback(
    (input: { placeId: string; lng: number; lat: number }) => {
      onCorrectLocation?.(input);
      setLocalCorrectingPlaceId(null);
    },
    [onCorrectLocation],
  );

  return (
      <section
        className={cn(
          "paper-panel atlas-plate flex flex-col overflow-hidden rounded-sm",
          className,
        )}
      >
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line/70 px-3 py-2.5 sm:px-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip chip-solid">舆图</span>
              {analysis.meta.provider === "demo" ? (
                <Badge tone="solid">内置样板 · 非模型生成</Badge>
              ) : analysis.meta.provider === "rule" ? (
                <Badge tone="muted">规则模式 · 仅地名</Badge>
              ) : analysis.meta.provider === "mock" ? (
                <Badge tone="muted">演示模式 · 非真实模型</Badge>
              ) : null}
              {hasApproximatePlaces ? (
                <Badge tone="medium">含模型粗定位</Badge>
              ) : null}
              <h2 className="truncate font-serif text-base text-ink sm:text-lg">
                {analysis.situation.title}
              </h2>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
              <span>{analysis.situation.timeLabel ?? "年代未标注"}</span>
              <span aria-hidden>·</span>
              <span>
                {scene && scenePosition >= 0
                  ? `第 ${scenePosition + 1} / ${scenes.length} 幕`
                  : "全篇视图"}
              </span>
              <span aria-hidden>·</span>
              <span>{places.length} 处已定位</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="muted">{routes.length} 路线</Badge>
            {areas.length > 0 ? (
              <Badge tone="muted">{areas.length} 区域</Badge>
            ) : null}
            {frontLines.length > 0 ? (
              <Badge tone="muted">{frontLines.length} 对峙线</Badge>
            ) : null}
            {unresolved.length > 0 ? (
              <Badge tone="low">{unresolved.length} 待考</Badge>
            ) : null}
            {onCollapse ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={onCollapse}
                aria-label="收起舆图"
                title="收起舆图，让阅读器居中"
              >
                <PanelRightClose className="h-4 w-4" aria-hidden />
                <span className="hidden xl:inline">收起</span>
              </Button>
            ) : null}
          </div>
        </header>

        <div
          className={cn(
            "relative grid min-h-0 flex-1",
            detailCollapsed
              ? "lg:grid-cols-1"
              : "lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]",
          )}
        >
          <div className="min-w-0 lg:h-full">
            <AtlasMap
              analysis={analysis}
              activeSceneIndex={activeSceneIndex}
              selectedFeature={selectedFeature}
              onSelectFeature={onSelectFeature}
              correctingPlaceId={effectiveCorrectingPlaceId}
              onCorrectLocation={
                canCorrect ? handleMapCorrectLocation : undefined
              }
              onCancelCorrection={
                effectiveCorrectingPlaceId ? cancelCorrection : undefined
              }
              className="h-[52dvh] min-h-[340px] rounded-none border-0 lg:h-full"
            />
          </div>

          <aside
            className={cn(
              "flex min-h-0 flex-col border-t border-line/70 bg-paper/70 lg:h-full lg:overflow-y-auto lg:border-l lg:border-t-0",
              detailCollapsed && "lg:hidden",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-1.5">
              <span className="text-[10px] uppercase tracking-[0.2em] text-ink-faint">
                态势详情
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="hidden min-h-7! min-w-7! lg:inline-flex"
                aria-label="收起态势详情"
                title="收起态势/证据/待考面板"
                onClick={() => setDetailCollapsed(true)}
              >
                <PanelRightClose className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="scrollbar-thin p-3 sm:p-4">
              {effectiveCorrectingPlaceId ? (
                <div className="mb-3 flex items-start gap-2 rounded-sm border border-cinnabar/35 bg-cinnabar/5 p-2.5 text-xs">
                  <Crosshair
                    className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-cinnabar"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-cinnabar">定位修正中</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-ink-soft">
                      点击地图为「{correctingPlace?.name ?? "该地点"}」选点；
                      选点后会记录为「用户修正」。
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-7! px-2! py-0!"
                    onClick={cancelCorrection}
                  >
                    取消
                  </Button>
                </div>
              ) : null}

              {resolvedSelection && selectedFeature ? (
                <SelectionDetail
                  analysis={analysis}
                  resolved={resolvedSelection}
                  correctingPlaceId={effectiveCorrectingPlaceId}
                  canCorrect={canCorrect}
                  onClearSelection={() => onSelectFeature(null)}
                  onBeginCorrection={beginCorrection}
                />
              ) : null}

              <Tabs value={panelTab} onValueChange={setPanelTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="summary">态势</TabsTrigger>
                  <TabsTrigger value="evidence">证据</TabsTrigger>
                  <TabsTrigger value="pending">
                    待考
                    {unresolved.length > 0 ? (
                      <span className="ml-1 text-[10px] text-cinnabar">
                        {unresolved.length}
                      </span>
                    ) : null}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="summary">
                  <SituationPanel
                    analysis={analysis}
                    scene={scene}
                    onSelectPlace={(placeId) =>
                      onSelectFeature({ type: "place", id: placeId })
                    }
                  />
                </TabsContent>
                <TabsContent value="evidence">
                  <EvidencePanel
                    analysis={analysis}
                    scene={scene}
                    resolved={resolvedSelection}
                  />
                </TabsContent>
                <TabsContent value="pending">
                  <UnresolvedPanel
                    analysis={analysis}
                    canCorrect={canCorrect}
                    onBeginCorrection={beginCorrection}
                    onUseCandidate={handleUseCandidate}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </aside>
          {detailCollapsed ? (
            <button
              type="button"
              onClick={() => setDetailCollapsed(false)}
              className="absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 items-center gap-1 rounded-l-sm border border-r-0 border-line/70 bg-surface/95 px-1.5 py-3 text-[10px] tracking-[0.12em] text-ink-soft shadow-sm transition-colors hover:bg-surface-soft hover:text-cinnabar lg:flex"
              aria-label="展开态势详情"
              title="展开态势/证据/待考面板"
              aria-expanded={false}
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden />
              <span style={{ writingMode: "vertical-rl" }}>态势</span>
            </button>
          ) : null}
        </div>

        <footer className="border-t border-line/70 bg-paper/60 px-3 py-3 sm:px-4">
          <AtlasTimeline
            scenes={scenes}
            activeIndex={activeSceneIndex}
            onIndexChange={onSceneChange}
          />
        </footer>
      </section>
  );
}
