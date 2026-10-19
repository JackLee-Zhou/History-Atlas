"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import type {
  Map as MapLibreMap,
  MapGeoJSONFeature,
  Marker as MapLibreMarker,
} from "maplibre-gl";
import {
  AlertTriangle,
  Info,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  Overview,
  OverviewPowerKind,
  OverviewRegion,
  OverviewStatus,
} from "@/lib/schema";

const STATUS_LABELS: Record<OverviewStatus, string> = {
  core: "较稳定控制",
  contested: "争夺区",
  nominal: "名义归附",
  presence: "活动区",
};

const KIND_LABELS: Record<OverviewPowerKind, string> = {
  dynasty: "王朝",
  regime: "政权",
  army: "军队/民变",
  coalition: "联盟",
  foreign: "外部势力",
  other: "势力",
};

function provinceShortName(name: string): string {
  return name
    .replace(/(维吾尔|壮族|回族|特别行政)?自治区$/u, "")
    .replace(/[省市]$/u, "");
}

function featureCenter(
  feature: FeatureCollection<Geometry>["features"][number],
): [number, number] | null {
  const points: Array<[number, number]> = [];
  const visit = (value: unknown): void => {
    if (
      Array.isArray(value) &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push([value[0], value[1]]);
      return;
    }
    if (Array.isArray(value)) for (const item of value) visit(item);
  };
  const walkGeometry = (geometry: Geometry): void => {
    if (geometry.type === "GeometryCollection") {
      for (const child of geometry.geometries) walkGeometry(child);
      return;
    }
    visit(geometry.coordinates);
  };
  walkGeometry(feature.geometry);
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

const STATUS_OPACITY: Record<OverviewStatus, number> = {
  core: 0.72,
  contested: 0.44,
  nominal: 0.52,
  presence: 0.28,
};

interface BasemapData {
  countries: FeatureCollection<Geometry>;
  provinces: FeatureCollection<Geometry>;
  rivers: FeatureCollection<Geometry>;
  lakes: FeatureCollection<Geometry>;
}

interface RegionProperties {
  name_zh?: string;
  province?: string;
  overviewColor?: string;
  overviewOpacity?: number;
  overviewContested?: boolean;
  overviewPresence?: boolean;
  overviewStatus?: OverviewStatus;
  overviewController?: string;
  overviewPowerIds?: string[];
  overviewHighlighted?: boolean;
  overviewHighlightColor?: string;
  overviewDimmed?: boolean;
}

function regionForProvince(
  overview: Overview | null,
  province: string,
): OverviewRegion | undefined {
  return overview?.regions.find((region) => region.province === province);
}

function decorateProvinces(
  data: FeatureCollection<Geometry>,
  overview: Overview | null,
  highlightedPowerId: string | null = null,
): FeatureCollection<Geometry> {
  return {
    ...data,
    features: data.features.map((feature) => {
      const props = (feature.properties ?? {}) as RegionProperties;
      const name = props.name_zh ?? "";
      const region = regionForProvince(overview, name);
      if (!region) {
        return {
          ...feature,
          properties: {
            ...props,
            overviewOpacity: 0.01,
            overviewDimmed: Boolean(highlightedPowerId),
          } satisfies RegionProperties,
        };
      }
      const first = region.controllers[0];
      const power = overview?.powers.find((item) => item.id === first?.powerId);
      const contested = region.controllers.some(
        (controller) => controller.status === "contested",
      );
      const presence = region.controllers.some(
        (controller) => controller.status === "presence",
      );
      const powerIds = region.controllers.map((controller) => controller.powerId);
      const highlighted = Boolean(
        highlightedPowerId && powerIds.includes(highlightedPowerId),
      );
      const highlightPower = highlightedPowerId
        ? overview?.powers.find((item) => item.id === highlightedPowerId)
        : undefined;
      return {
        ...feature,
        properties: {
          ...props,
          overviewColor: power?.color ?? "#8a7a5f",
          overviewOpacity: first ? STATUS_OPACITY[first.status] : 0.25,
          overviewContested: contested,
          overviewPresence: presence,
          overviewStatus: first?.status,
          overviewController: power?.name ?? "",
          overviewPowerIds: powerIds,
          overviewHighlighted: highlighted,
          overviewHighlightColor: highlightPower?.color ?? "#fff8ea",
          overviewDimmed: Boolean(highlightedPowerId) && !highlighted,
        } satisfies RegionProperties,
      };
    }),
  };
}

function statusLabel(status: OverviewStatus): string {
  return STATUS_LABELS[status];
}

function OverviewMap({
  overview,
  data,
  highlightedPowerId,
  onHighlightPower,
  onSelectProvince,
}: {
  overview: Overview;
  data: BasemapData;
  highlightedPowerId: string | null;
  onHighlightPower(powerId: string | null): void;
  onSelectProvince(province: string | null): void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const labelMarkersRef = useRef<MapLibreMarker[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const pulseRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function createMap(): Promise<void> {
      if (!containerRef.current) return;
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled) return;
        maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
        const decorated = decorateProvinces(
          data.provinces,
          overview,
          highlightedPowerId,
        );
        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              countries: { type: "geojson", data: data.countries },
              provinces: { type: "geojson", data: decorated },
              rivers: { type: "geojson", data: data.rivers },
              lakes: { type: "geojson", data: data.lakes },
            },
            layers: [
              { id: "background", type: "background", paint: { "background-color": "#f4ead5" } },
              {
                id: "countries-fill",
                type: "fill",
                source: "countries",
                paint: { "fill-color": "#efe4cc", "fill-opacity": 1 },
              },
              {
                id: "lakes-fill",
                type: "fill",
                source: "lakes",
                paint: { "fill-color": "#c8dce0" },
              },
              {
                id: "rivers-line",
                type: "line",
                source: "rivers",
                paint: { "line-color": "#8fb3bd", "line-width": 0.8 },
              },
              {
                id: "provinces-fill",
                type: "fill",
                source: "provinces",
                paint: {
                  "fill-color": [
                    "coalesce",
                    ["get", "overviewColor"],
                    "#e9e2d3",
                  ],
                  "fill-opacity": [
                    "case",
                    ["==", ["get", "overviewDimmed"], true],
                    0.035,
                    ["coalesce", ["get", "overviewOpacity"], 0.01],
                  ],
                },
              },
              {
                id: "provinces-contested",
                type: "line",
                source: "provinces",
                filter: ["==", ["get", "overviewContested"], true],
                paint: {
                  "line-color": ["coalesce", ["get", "overviewColor"], "#9b2c2c"],
                  "line-width": 1.6,
                  "line-dasharray": [2, 2],
                },
              },
              {
                id: "provinces-outline",
                type: "line",
                source: "provinces",
                paint: {
                  "line-color": "#7d6b50",
                  "line-width": 1.05,
                  "line-opacity": 0.9,
                },
              },
              {
                id: "provinces-power-highlight",
                type: "fill",
                source: "provinces",
                filter: ["==", ["get", "overviewHighlighted"], true],
                paint: {
                  "fill-color": [
                    "coalesce",
                    ["get", "overviewHighlightColor"],
                    "#fff8ea",
                  ],
                  "fill-opacity": 0.2,
                },
              },
              {
                id: "provinces-power-highlight-line",
                type: "line",
                source: "provinces",
                filter: ["==", ["get", "overviewHighlighted"], true],
                paint: {
                  "line-color": "#fff8ea",
                  "line-width": 2.6,
                  "line-opacity": 0.95,
                },
              },
              {
                id: "provinces-hover",
                type: "fill",
                source: "provinces",
                filter: ["==", ["get", "name_zh"], ""],
                paint: {
                  "fill-color": "#fffdf6",
                  "fill-opacity": 0.18,
                },
              },
              {
                id: "provinces-hover-line",
                type: "line",
                source: "provinces",
                filter: ["==", ["get", "name_zh"], ""],
                paint: {
                  "line-color": "#fffdf6",
                  "line-width": 2.4,
                  "line-opacity": 1,
                },
              },
            ],
          },
          center: [104, 35],
          zoom: 3.1,
          minZoom: 2,
          maxZoom: 8,
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(
          new maplibregl.NavigationControl({
            showCompass: false,
            visualizePitch: false,
          }),
          "top-right",
        );
        map.addControl(
          new maplibregl.AttributionControl({ compact: true }),
          "bottom-right",
        );

        map.on("load", () => {
          if (!map || cancelled) return;
          setReady(true);
          const wide = window.innerWidth >= 1024;
          map.fitBounds(
            [
              [73, 17],
              [135, 54],
            ],
            {
              padding: {
                top: 36,
                bottom: 36,
                left: 36,
                right: wide ? 366 : 36,
              },
              duration: 0,
            },
          );
        });

        const clearHover = (): void => {
          if (!map) return;
          hoveredRef.current = null;
          if (pulseRef.current !== null) {
            cancelAnimationFrame(pulseRef.current);
            pulseRef.current = null;
          }
          map.setFilter("provinces-hover", [
            "==",
            ["get", "name_zh"],
            "",
          ]);
          map.setFilter("provinces-hover-line", [
            "==",
            ["get", "name_zh"],
            "",
          ]);
          map.setPaintProperty("provinces-hover", "fill-opacity", 0.18);
          map.setPaintProperty("provinces-hover-line", "line-width", 2.4);
          map.getCanvas().style.cursor = "";
        };

        const pulseHover = (): void => {
          if (!map || !hoveredRef.current) return;
          if (pulseRef.current !== null) return;
          const reduceMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          if (reduceMotion) return;
          const started = performance.now();
          const tick = (now: number): void => {
            if (!map || !hoveredRef.current) {
              pulseRef.current = null;
              return;
            }
            const phase = (Math.sin((now - started) / 165) + 1) / 2;
            map.setPaintProperty(
              "provinces-hover",
              "fill-opacity",
              0.1 + phase * 0.16,
            );
            map.setPaintProperty(
              "provinces-hover-line",
              "line-width",
              1.8 + phase * 2.4,
            );
            pulseRef.current = requestAnimationFrame(tick);
          };
          pulseRef.current = requestAnimationFrame(tick);
        };

        map.on("mousemove", "provinces-fill", (event) => {
          const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
          const name =
            typeof feature?.properties?.name_zh === "string"
              ? feature.properties.name_zh
              : null;
          if (!map || !name || name === hoveredRef.current) return;
          hoveredRef.current = name;
          map.getCanvas().style.cursor = "pointer";
          map.setFilter("provinces-hover", ["==", ["get", "name_zh"], name]);
          map.setFilter("provinces-hover-line", [
            "==",
            ["get", "name_zh"],
            name,
          ]);
          pulseHover();
        });
        map.on("mouseleave", "provinces-fill", clearHover);

        map.on("click", "provinces-fill", (event) => {
          const feature = event.features?.[0] as MapGeoJSONFeature | undefined;
          const name =
            typeof feature?.properties?.name_zh === "string"
              ? feature.properties.name_zh
              : null;
          if (name) onSelectProvince(name);
        });

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        if (!cancelled) {
          setMapError(error instanceof Error ? error.message : "地图初始化失败");
        }
      }
    }

    void createMap();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (pulseRef.current !== null) {
        cancelAnimationFrame(pulseRef.current);
        pulseRef.current = null;
      }
      map?.remove();
      mapRef.current = null;
    };
    // The map is intentionally created once per data set; overview updates
    // are pushed into the source by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("provinces");
    if (source && "setData" in source) {
      (source as { setData(data: unknown): void }).setData(
        decorateProvinces(data.provinces, overview, highlightedPowerId),
      );
    }
  }, [data, highlightedPowerId, overview, ready]);


  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function renderLabels(): Promise<void> {
      const maplibregl = await import("maplibre-gl");
      if (cancelled) return;
      for (const marker of labelMarkersRef.current) marker.remove();
      labelMarkersRef.current = [];
      const map = mapRef.current;
      if (!map) return;
      const features = new Map(
        data.provinces.features.map((feature) => [
          (feature.properties as RegionProperties | null)?.name_zh ?? "",
          feature,
        ]),
      );
      for (const region of overview.regions) {
        const feature = features.get(region.province);
        if (!feature) continue;
        const center = featureCenter(feature);
        if (!center) continue;
        const first = region.controllers[0];
        const power = overview.powers.find(
          (item) => item.id === first?.powerId,
        );
        const element = document.createElement("div");
        element.className = "overview-province-label";
        const dot = document.createElement("i");
        dot.style.background = power?.color ?? "#8a7a5f";
        element.append(dot, document.createTextNode(provinceShortName(region.province)));
        const marker = new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(center)
          .addTo(map);
        labelMarkersRef.current.push(marker);
      }
    }
    void renderLabels();
    return () => {
      cancelled = true;
      for (const marker of labelMarkersRef.current) marker.remove();
      labelMarkersRef.current = [];
    };
  }, [data.provinces, overview, ready]);



  return (
    <div className="overview-map-frame">
      <div className="overview-map">
        <div ref={containerRef} className="overview-map-canvas" />
      </div>
      <div className="overview-map__badge">
        <span>天下大势</span>
        <strong>{overview.asOf.label}</strong>
        <em>AI 推演 · 省域示意</em>
      </div>
      <div className="overview-map__legend" role="group" aria-label="势力图例">
        {overview.powers.slice(0, 8).map((power) => {
          const active = highlightedPowerId === power.id;
          return (
            <button
              key={power.id}
              type="button"
              className={active ? "is-active" : undefined}
              aria-pressed={active}
              onClick={() =>
                onHighlightPower(active ? null : power.id)
              }
              title={`高亮${power.name}控制/活动省份`}
            >
              <i style={{ background: power.color }} />
              {power.name}
            </button>
          );
        })}
      </div>
      {mapError ? (
        <div className="overview-map__error">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {mapError}
        </div>
      ) : !ready ? (
        <div className="overview-map__loading">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          正在铺开省域底图…
        </div>
      ) : null}
    </div>
  );
}

function OverviewPanel({
  overview,
  selectedProvince,
  highlightedPowerId,
  onHighlightPower,
  onSelectProvince,
  onClose,
  onRetry,
}: {
  overview: Overview;
  selectedProvince: string | null;
  highlightedPowerId: string | null;
  onHighlightPower(powerId: string | null): void;
  onSelectProvince(province: string | null): void;
  onClose(): void;
  onRetry(): void;
}) {
  const selected = selectedProvince
    ? overview.regions.find((region) => region.province === selectedProvince)
    : undefined;
  return (
    <aside className="overview-panel">
      <header className="overview-panel__head">
        <div>
          <p className="overview-kicker">AI 天下大势</p>
          <h2>{overview.asOf.label}</h2>
        </div>
        <button
          type="button"
          className="overview-icon-btn"
          onClick={onClose}
          aria-label="关闭天下大势"
          title="关闭天下大势"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className="overview-panel__scroll">
        <p className="overview-summary">{overview.summary}</p>
        <div className="overview-note">
          <Info className="h-3.5 w-3.5" aria-hidden />
          <span>省界为现代底图；范围为 AI 推演，不是精确历史疆域。</span>
        </div>

        <section className="overview-section">
          <h3>势力</h3>
          <ul className="overview-powers">
            {overview.powers.map((power) => {
              const active = highlightedPowerId === power.id;
              return (
                <li key={power.id}>
                  <button
                    type="button"
                    className={active ? "is-active" : undefined}
                    aria-pressed={active}
                    onClick={() =>
                      onHighlightPower(active ? null : power.id)
                    }
                    title={`高亮${power.name}控制/活动省份`}
                  >
                    <i style={{ background: power.color }} />
                    <span>
                      <strong>{power.name}</strong>
                      <em>{KIND_LABELS[power.kind]}</em>
                    </span>
                    {active ? <span className="overview-power-active">显示中</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="overview-section">
          <h3>省级控制</h3>
          {selected ? (
            <div className="overview-province">
              <div className="overview-province__title">
                <strong>{selected.province}</strong>
                <button type="button" onClick={() => onSelectProvince(null)}>
                  清除
                </button>
              </div>
              {selected.controllers.map((controller) => {
                const power = overview.powers.find(
                  (item) => item.id === controller.powerId,
                );
                return (
                  <p key={controller.powerId}>
                    <i style={{ background: power?.color ?? "#8a7a5f" }} />
                    {power?.name ?? "未知势力"}
                    <em>{statusLabel(controller.status)}</em>
                    <small>{Math.round(controller.confidence * 100)}%</small>
                    {controller.note ? <span>{controller.note}</span> : null}
                  </p>
                );
              })}
            </div>
          ) : (
            <p className="overview-hint">点击地图上的省份查看控制情况。</p>
          )}
        </section>

        <section className="overview-section">
          <h3>状态图例</h3>
          <ul className="overview-status-list">
            {(Object.keys(STATUS_LABELS) as OverviewStatus[]).map((status) => (
              <li key={status}>
                <i data-status={status} />
                {statusLabel(status)}
              </li>
            ))}
          </ul>
        </section>

        {overview.caveats.length > 0 ? (
          <section className="overview-section overview-caveats">
            <h3>说明</h3>
            {overview.caveats.map((caveat) => (
              <p key={caveat}>{caveat}</p>
            ))}
          </section>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="overview-retry"
          onClick={onRetry}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          重新推演
        </Button>
      </div>
    </aside>
  );
}

export interface OverviewWorkspaceProps {
  overview: Overview | null;
  loading?: boolean;
  error?: string | null;
  onClose(): void;
  onRetry(): void;
  className?: string;
}

export function OverviewWorkspace({
  overview,
  loading = false,
  error = null,
  onClose,
  onRetry,
  className,
}: OverviewWorkspaceProps) {
  const [data, setData] = useState<BasemapData | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [selectedProvince, setSelectedProvince] = useState<string | null>(null);
  const [highlightedPowerId, setHighlightedPowerId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [countries, provinces, rivers, lakes] = await Promise.all([
          fetch("/basemap/countries.geojson").then((response) => response.json()),
          fetch("/basemap/provinces.geojson").then((response) => response.json()),
          fetch("/basemap/rivers.geojson").then((response) => response.json()),
          fetch("/basemap/lakes.geojson").then((response) => response.json()),
        ]);
        if (!cancelled) {
          setData({
            countries: countries as FeatureCollection<Geometry>,
            provinces: provinces as FeatureCollection<Geometry>,
            rivers: rivers as FeatureCollection<Geometry>,
            lakes: lakes as FeatureCollection<Geometry>,
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setDataError(
            loadError instanceof Error ? loadError.message : "底图读取失败",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const errorText = error ?? dataError;

  return (
    <div className={`overview-workspace ${className ?? ""}`}>
      {overview ? (
        <OverviewMap
          overview={overview}
          data={data ?? {
            countries: { type: "FeatureCollection", features: [] },
            provinces: { type: "FeatureCollection", features: [] },
            rivers: { type: "FeatureCollection", features: [] },
            lakes: { type: "FeatureCollection", features: [] },
          }}
          highlightedPowerId={highlightedPowerId}
          onHighlightPower={setHighlightedPowerId}
          onSelectProvince={setSelectedProvince}
        />
      ) : (
        <div className="overview-placeholder">
          {loading ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              <p>正在推演当前天下大势…</p>
              <span>会结合书名、章节、年代与人物做一个省域级近似快照。</span>
            </>
          ) : errorText ? (
            <>
              <AlertTriangle className="h-6 w-6" aria-hidden />
              <p>天下大势暂时没有生成</p>
              <span>{errorText}</span>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                重试
              </Button>
            </>
          ) : null}
        </div>
      )}

      {overview ? (
        <OverviewPanel
          overview={overview}
          selectedProvince={selectedProvince}
          highlightedPowerId={highlightedPowerId}
          onHighlightPower={setHighlightedPowerId}
          onSelectProvince={setSelectedProvince}
          onClose={onClose}
          onRetry={onRetry}
        />
      ) : (
        <aside className="overview-panel overview-panel--empty">
          <header className="overview-panel__head">
            <div>
              <p className="overview-kicker">AI 天下大势</p>
              <h2>{loading ? "正在推演" : "未生成"}</h2>
            </div>
            <button
              type="button"
              className="overview-icon-btn"
              onClick={onClose}
              aria-label="关闭天下大势"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </header>
          <div className="overview-panel__scroll">
            <p className="overview-hint">
              这是按当前章节年代生成的省域级历史推演，不要求回到原文证据。
              需要配置模型服务；没有 key 时不会伪造结果。
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
