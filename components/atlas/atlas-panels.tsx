"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Quote,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { distanceKm, scenePlaces } from "@/lib/geo";
import type { Analysis, Citation, Place, Scene } from "@/lib/schema";
import {
  confidenceTone,
  formatConfidence,
  formatDistanceKm,
} from "@/lib/utils";
import {
  citationRange,
  confidencePercent,
  factionName,
  locationSourceLabel,
  placeCategoryLabel,
  precisionLabel,
  routeKindLabel,
  routeTitle,
} from "./labels";
import type { ResolvedSelection } from "./selection";
import {
  resolveCitations,
  sceneEvidenceIds,
  selectionEvidenceIds,
} from "./selection";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.22em] text-ink-faint">
      {children}
    </p>
  );
}

const SELECTION_TYPE_LABELS: Record<ResolvedSelection["type"], string> = {
  place: "地点",
  route: "路线",
  area: "势力范围",
  frontline: "对峙线",
};

export function CitationQuotes({
  citations,
  emptyLabel = "暂无引文证据。",
}: {
  citations: Citation[];
  emptyLabel?: string;
}) {
  if (citations.length === 0) {
    return (
      <p className="mt-2 rounded-sm border border-dashed border-line/70 p-2.5 text-[11px] text-ink-faint">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="mt-3">
      <SectionLabel>原文证据</SectionLabel>
      <ul className="mt-1.5 space-y-2">
        {citations.map((citation) => (
          <li
            key={citation.id}
            className="rounded-sm border border-line/60 bg-surface/65 p-2.5"
          >
            <blockquote className="font-serif text-xs leading-6 text-ink">
              “{citation.quote}”
            </blockquote>
            <p className="mt-1 text-[10px] text-ink-faint">
              {citationRange(citation)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlaceBody({
  analysis,
  place,
  canCorrect,
  correcting,
  onBeginCorrection,
}: {
  analysis: Analysis;
  place: Place;
  canCorrect: boolean;
  correcting: boolean;
  onBeginCorrection(placeId: string): void;
}) {
  const location = place.location;
  const citations = resolveCitations(
    analysis.situation.citations,
    place.evidence,
  );

  return (
    <>
      <dl className="mt-2.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs leading-5 text-ink-soft">
        <dt className="text-ink-faint">今地</dt>
        <dd>{place.modernName ?? "未考"}</dd>
        {place.locationNote ? (
          <>
            <dt className="text-ink-faint">依据</dt>
            <dd className="text-[11px] leading-5 text-ink-soft">
              {place.locationNote}
            </dd>
          </>
        ) : null}
        {place.role ? (
          <>
            <dt className="text-ink-faint">作用</dt>
            <dd>{place.role}</dd>
          </>
        ) : null}
        {location ? (
          <>
            <dt className="text-ink-faint">坐标</dt>
            <dd>
              {location.lng.toFixed(3)}, {location.lat.toFixed(3)}
            </dd>
            <dt className="text-ink-faint">精度</dt>
            <dd>
              {precisionLabel(place)} · 误差半径约 {location.radiusKm} km
            </dd>
            <dt className="text-ink-faint">置信</dt>
            <dd>
              {formatConfidence(location.confidence)}（
              {confidencePercent(location.confidence)}）
            </dd>
            <dt className="text-ink-faint">来源</dt>
            <dd>{locationSourceLabel(place)}</dd>
          </>
        ) : (
          <>
            <dt className="text-ink-faint">状态</dt>
            <dd>待考，不画为确定点位</dd>
          </>
        )}
      </dl>

      {!location && place.unresolved ? (
        <div className="mt-2.5 flex items-start gap-2 rounded-sm border border-cinnabar/25 bg-cinnabar/5 p-2.5 text-[11px] leading-5 text-ink-soft">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cinnabar"
            aria-hidden
          />
          <span>待考原因：{place.unresolved.reason}</span>
        </div>
      ) : null}

      <CitationQuotes citations={citations} />

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-[10px] text-ink-faint">
          证据 {citations.length} 条 · 来源 {locationSourceLabel(place)}
        </p>
        {canCorrect ? (
          <Button
            size="sm"
            variant={correcting ? "primary" : "outline"}
            disabled={correcting}
            onClick={() => onBeginCorrection(place.id)}
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            {correcting
              ? "正在选点…"
              : location
                ? "定位修正"
                : "在地图上定位"}
          </Button>
        ) : null}
      </div>
    </>
  );
}

function RouteBody({
  analysis,
  route,
}: {
  analysis: Analysis;
  route: Extract<ResolvedSelection, { type: "route" }>["route"];
}) {
  const places = analysis.situation.places;
  const from = places.find((place) => place.id === route.fromPlaceId);
  const to = places.find((place) => place.id === route.toPlaceId);
  const citations = resolveCitations(
    analysis.situation.citations,
    route.evidence,
  );
  const span =
    from?.location && to?.location
      ? formatDistanceKm(
          distanceKm(
            [from.location.lng, from.location.lat],
            [to.location.lng, to.location.lat],
          ),
        )
      : null;

  return (
    <>
      <dl className="mt-2.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs leading-5 text-ink-soft">
        <dt className="text-ink-faint">起止</dt>
        <dd>
          {from?.name ?? "未知"} → {to?.name ?? "未知"}
        </dd>
        <dt className="text-ink-faint">类型</dt>
        <dd>{routeKindLabel(route)}</dd>
        {span ? (
          <>
            <dt className="text-ink-faint">距离</dt>
            <dd>直线约 {span}（示意）</dd>
          </>
        ) : null}
        <dt className="text-ink-faint">来源</dt>
        <dd>原文引文（{citations.length} 条）</dd>
      </dl>

      <p className="mt-2 rounded-sm border border-dashed border-line/70 p-2.5 text-[11px] leading-5 text-ink-faint">
        路线为两地之间的直线示意，箭头指向终点；不代表真实道路走向。
      </p>

      <CitationQuotes citations={citations} />
    </>
  );
}

function AreaBody({
  analysis,
  selection,
}: {
  analysis: Analysis;
  selection: Extract<ResolvedSelection, { type: "area" }>;
}) {
  const citations = resolveCitations(
    analysis.situation.citations,
    selection.area.evidence,
  );
  return (
    <>
      <dl className="mt-2.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs leading-5 text-ink-soft">
        <dt className="text-ink-faint">势力</dt>
        <dd>
          {factionName(analysis.situation.factions, selection.area.factionId)}
        </dd>
        <dt className="text-ink-faint">性质</dt>
        <dd>控制区示意，非精确边界</dd>
        <dt className="text-ink-faint">来源</dt>
        <dd>原文引文（{citations.length} 条）</dd>
      </dl>
      <p className="mt-2 rounded-sm border border-dashed border-line/70 p-2.5 text-[11px] leading-5 text-ink-faint">
        {selection.area.name}仅表达“谁大致控制哪片区域”，请勿当作历史疆界。
      </p>
      <CitationQuotes citations={citations} />
    </>
  );
}

function FrontLineBody({
  analysis,
  selection,
}: {
  analysis: Analysis;
  selection: Extract<ResolvedSelection, { type: "frontline" }>;
}) {
  const citations = resolveCitations(
    analysis.situation.citations,
    selection.frontline.evidence,
  );
  const names = selection.frontline.factionIds
    .map((id) => factionName(analysis.situation.factions, id))
    .join(" / ");
  return (
    <>
      <dl className="mt-2.5 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-xs leading-5 text-ink-soft">
        <dt className="text-ink-faint">双方</dt>
        <dd>{names}</dd>
        <dt className="text-ink-faint">性质</dt>
        <dd>对峙线示意，非精确战线</dd>
        <dt className="text-ink-faint">来源</dt>
        <dd>原文引文（{citations.length} 条）</dd>
      </dl>
      <p className="mt-2 rounded-sm border border-dashed border-line/70 p-2.5 text-[11px] leading-5 text-ink-faint">
        对峙线为双方接触方向的示意，不代表实际阵线位置。
      </p>
      <CitationQuotes citations={citations} />
    </>
  );
}

export interface SelectionDetailProps {
  analysis: Analysis;
  resolved: ResolvedSelection;
  correctingPlaceId: string | null;
  canCorrect: boolean;
  onClearSelection(): void;
  onBeginCorrection(placeId: string): void;
}

export function SelectionDetail({
  analysis,
  resolved,
  correctingPlaceId,
  canCorrect,
  onClearSelection,
  onBeginCorrection,
}: SelectionDetailProps) {
  const title =
    resolved.type === "place"
      ? resolved.place.name
      : resolved.type === "route"
        ? routeTitle(resolved.route, analysis.situation.places)
        : resolved.type === "area"
          ? resolved.area.name
          : resolved.frontline.name ?? "对峙线";

  return (
    <section className="mb-3 rounded-sm border border-line/80 bg-surface/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.22em] text-ink-faint">
            当前选中 · {SELECTION_TYPE_LABELS[resolved.type]}
          </p>
          <h3 className="mt-0.5 truncate font-serif text-base text-ink">
            {title}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="取消选中"
          title="取消选中"
          onClick={onClearSelection}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {resolved.type === "place" ? (
          <>
            <Badge>{placeCategoryLabel(resolved.place)}</Badge>
            {resolved.place.location ? (
              <Badge
                tone={confidenceTone(resolved.place.location.confidence)}
                title="定位置信度"
              >
                {precisionLabel(resolved.place)} ·{" "}
                {confidencePercent(resolved.place.location.confidence)}
              </Badge>
            ) : (
              <Badge tone="low">待考</Badge>
            )}
            {resolved.place.factionId ? (
              <Badge tone="solid">
                {factionName(
                  analysis.situation.factions,
                  resolved.place.factionId,
                )}
              </Badge>
            ) : null}
          </>
        ) : null}

        {resolved.type === "route" ? (
          <>
            <Badge>{routeKindLabel(resolved.route)}</Badge>
            {resolved.route.factionId ? (
              <Badge tone="solid">
                {factionName(
                  analysis.situation.factions,
                  resolved.route.factionId,
                )}
              </Badge>
            ) : null}
          </>
        ) : null}

        {resolved.type === "area" ? (
          <>
            <Badge tone="solid">
              {factionName(
                analysis.situation.factions,
                resolved.area.factionId,
              )}
            </Badge>
            <Badge tone="muted">示意图</Badge>
          </>
        ) : null}

        {resolved.type === "frontline" ? (
          <>
            <Badge tone="solid">对峙双方</Badge>
            <Badge tone="muted">示意图</Badge>
          </>
        ) : null}
      </div>

      {resolved.type === "place" ? (
        <PlaceBody
          analysis={analysis}
          place={resolved.place}
          canCorrect={canCorrect}
          correcting={correctingPlaceId === resolved.place.id}
          onBeginCorrection={onBeginCorrection}
        />
      ) : null}
      {resolved.type === "route" ? (
        <RouteBody analysis={analysis} route={resolved.route} />
      ) : null}
      {resolved.type === "area" ? (
        <AreaBody analysis={analysis} selection={resolved} />
      ) : null}
      {resolved.type === "frontline" ? (
        <FrontLineBody analysis={analysis} selection={resolved} />
      ) : null}
    </section>
  );
}

export function SituationPanel({
  analysis,
  scene,
  onSelectPlace,
}: {
  analysis: Analysis;
  scene: Scene | null;
  onSelectPlace?(placeId: string): void;
}) {
  const summary = analysis.situation.summary;
  const locatedPlaces = scenePlaces(analysis, scene);
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel>{scene ? "本幕态势" : "全篇态势"}</SectionLabel>
        {scene ? (
          <>
            <p className="mt-1 font-serif text-sm text-ink">
              {scene.title}
              {scene.timeLabel ? (
                <span className="ml-2 text-[11px] text-ink-faint">
                  {scene.timeLabel}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-xs leading-6 text-ink-soft">
              {scene.summary}
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs leading-6 text-ink-soft">
            这次分析没有分幕，地图显示全部已定位要素。
          </p>
        )}
      </div>

      <div>
        <SectionLabel>总览</SectionLabel>
        <p className="mt-1 text-sm leading-7 text-ink-soft">
          {summary.overview}
        </p>
      </div>

      {summary.keyPoints.length > 0 ? (
        <div>
          <SectionLabel>关键点</SectionLabel>
          <ul className="mt-1.5 space-y-1.5">
            {summary.keyPoints.map((point, index) => (
              <li
                key={`${index}-${point.slice(0, 12)}`}
                className="flex items-start gap-2 text-xs leading-5 text-ink-soft"
              >
                <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gold/15 font-serif text-[10px] text-gold">
                  {index + 1}
                </span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.uncertainty.length > 0 ? (
        <div>
          <SectionLabel>不确定之处</SectionLabel>
          <ul className="mt-1.5 space-y-1.5">
            {summary.uncertainty.map((item, index) => (
              <li
                key={`${index}-${item.slice(0, 12)}`}
                className="flex items-start gap-2 text-xs leading-5 text-ink-soft"
              >
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold"
                  aria-hidden
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {locatedPlaces.length > 0 ? (
        <div data-testid="atlas-place-list">
          <SectionLabel>已定位地点 · {locatedPlaces.length}</SectionLabel>
          <p className="mt-1 text-[11px] leading-5 text-ink-faint">
            点位重叠时，点下面的名称也能选中地点并回到原文证据。
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-1.5">
            {locatedPlaces.map((place) => {
              const color =
                analysis.situation.factions.find(
                  (faction) => faction.id === place.factionId,
                )?.color ?? "#5b5346";
              return (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPlace?.(place.id)}
                    aria-label={`查看${place.name}`}
                    className="flex w-full items-center gap-2 rounded-sm border border-line/55 bg-surface/60 px-2 py-1.5 text-left transition-colors hover:border-cinnabar/40 hover:bg-surface"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-serif text-xs text-ink">
                      {place.name}
                    </span>
                    <span className="max-w-[55%] truncate text-[10px] text-ink-faint">
                      {place.modernName ?? "今地未详"}
                    </span>
                    {!place.location ? (
                      <Badge tone="low">待考</Badge>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="rounded-sm border border-dashed border-line/70 p-2.5 text-[11px] leading-5 text-ink-faint">
        地图上的控制区与对峙线均为示意；未定位地点不会画成确定点位。所有要素都可回到原文证据。
      </p>
      {analysis.situation.places.some((place) => Boolean(place.locationNote)) ||
      analysis.meta.warnings.some(
        (item) =>
          item.code === "APPROXIMATE_OVERVIEW" ||
          item.code === "LOCATION_APPROXIMATED",
      ) ? (
        <p className="rounded-sm border border-gold/25 bg-gold/8 p-2.5 text-[11px] leading-5 text-ink-soft">
          部分地点是模型补全的今地提示后由现代地名库粗定位，坐标仍不是考古级位置；适合建立整体印象，引用原文时请保留这层不确定性。
        </p>
      ) : null}


    </div>
  );
}

export function EvidencePanel({
  analysis,
  scene,
  resolved,
}: {
  analysis: Analysis;
  scene: Scene | null;
  resolved: ResolvedSelection | null;
}) {
  const ids = resolved
    ? selectionEvidenceIds(resolved)
    : sceneEvidenceIds(analysis, scene);
  const citations = resolveCitations(analysis.situation.citations, ids);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>
          {resolved ? "所选要素的证据" : scene ? "本幕证据" : "全篇证据"}
        </SectionLabel>
        <span className="chip">
          <Quote className="h-3 w-3" aria-hidden />
          {citations.length} 条
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-ink-faint">
        证据引文均对应章节原文区间；地图要素只有被证据支撑时才会出现。
      </p>
      <CitationQuotes
        citations={citations}
        emptyLabel="当前范围内没有可展示的引文证据。"
      />
    </div>
  );
}

export interface UnresolvedPanelProps {
  analysis: Analysis;
  canCorrect: boolean;
  onBeginCorrection(placeId: string): void;
  onUseCandidate(input: {
    placeId: string;
    lng: number;
    lat: number;
  }): void;
}

export function UnresolvedPanel({
  analysis,
  canCorrect,
  onBeginCorrection,
  onUseCandidate,
}: UnresolvedPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const unresolved = analysis.situation.places.filter(
    (place) => !place.location,
  );

  if (unresolved.length === 0) {
    return (
      <div>
        <SectionLabel>待考地点</SectionLabel>
        <p className="mt-2 rounded-sm border border-dashed border-line/70 p-3 text-xs leading-6 text-ink-faint">
          当前分析中的地点都已定位，没有待考条目。
        </p>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel>待考地点 · {unresolved.length}</SectionLabel>
      <p className="mt-1 text-[11px] leading-5 text-ink-faint">
        这些地点缺少可用坐标，不会被画成确定点位。展开可查看候选；未定位地点不会画成确定点位。
      </p>
      <ul className="mt-2 space-y-2">
        {unresolved.map((place) => {
          const expanded = expandedId === place.id;
          const candidates = place.unresolved?.candidates ?? [];
          return (
            <li
              key={place.id}
              className="overflow-hidden rounded-sm border border-line/70 bg-surface/65"
            >
              <button
                type="button"
                className="flex w-full items-start gap-2 p-2.5 text-left"
                aria-expanded={expanded}
                aria-controls={`atlas-candidates-${place.id}`}
                onClick={() => setExpandedId(expanded ? null : place.id)}
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-cinnabar"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="font-serif text-sm text-ink">
                    {place.name}
                  </span>
                  <span className="ml-1.5 text-[10px] text-ink-faint">
                    {placeCategoryLabel(place)}
                  </span>
                  <span className="mt-1 block text-[11px] leading-5 text-ink-soft">
                    {place.unresolved?.reason ?? "缺少定位依据。"}
                  </span>
                </span>
                {expanded ? (
                  <ChevronDown
                    className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint"
                    aria-hidden
                  />
                ) : (
                  <ChevronRight
                    className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint"
                    aria-hidden
                  />
                )}
              </button>

              {expanded ? (
                <div
                  id={`atlas-candidates-${place.id}`}
                  className="border-t border-line/60 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <SectionLabel>候选</SectionLabel>
                    {canCorrect ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onBeginCorrection(place.id)}
                      >
                        <Crosshair className="h-3.5 w-3.5" aria-hidden />
                        在地图上定位
                      </Button>
                    ) : null}
                  </div>

                  {candidates.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {candidates.map((candidate, index) => {
                        const hasCoordinates =
                          candidate.lng !== undefined &&
                          candidate.lat !== undefined;
                        return (
                          <li
                            key={`${place.id}-candidate-${index}`}
                            className="flex items-center justify-between gap-2 rounded-sm border border-line/50 px-2 py-1.5"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs text-ink">
                                {candidate.label}
                              </span>
                              <span className="text-[10px] text-ink-faint">
                                {hasCoordinates
                                  ? `${candidate.lng?.toFixed(3)}, ${candidate.lat?.toFixed(3)}`
                                  : "候选未附坐标"}
                              </span>
                            </span>
                            {canCorrect ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!hasCoordinates}
                                title="采用候选坐标（会记录为用户修正）"
                                onClick={() => {
                                  if (
                                    candidate.lng === undefined ||
                                    candidate.lat === undefined
                                  ) {
                                    return;
                                  }
                                  onUseCandidate({
                                    placeId: place.id,
                                    lng: candidate.lng,
                                    lat: candidate.lat,
                                  });
                                }}
                              >
                                采用
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-[11px] text-ink-faint">
                      暂无候选；未定位地点不会画成确定点位。
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
