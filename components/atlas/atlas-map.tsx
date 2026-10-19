"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import {
  AlertTriangle,
  Crosshair,
  Info,
  Layers,
  RotateCcw,
} from "lucide-react";
import type {
  Map as MapLibreMap,
  MapMouseEvent,
  MapOptions,
  Marker as MapLibreMarker,
  Subscription,
} from "maplibre-gl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  MAP_INITIAL_CENTER,
  MAP_INITIAL_ZOOM,
  MAP_MAX_ZOOM,
} from "@/lib/constants";
import {
  areaFeatureCollection,
  arrowFeatures,
  curvedPointAt,
  emptyFeatureCollection,
  featureBounds,
  frontLineFeatureCollection,
  frontLineTickCollection,
  MAP_EFFECTS,
  placeEffect,
  routeEffect,
  sceneFrontLines,
  getScene,
  isLowConfidence,
  placeAccuracyFeatureCollection,
  routeFeatureCollection,
  scenePlaces,
  sceneRoutes,
} from "@/lib/geo";
import type { AtlasSelection } from "@/lib/geo";
import type { Analysis, Place } from "@/lib/schema";
import { cn } from "@/lib/utils";
import { factionColor } from "./labels";

const ARROW_IMAGE_ID = "atlas-arrow";
const CONTROL_HATCH_ID = "atlas-control-hatch";
const ROUTE_LAYER_IDS = [
  "route-line-march",
  "route-line-retreat",
  "route-line-reinforce",
  "route-line-transport",
] as const;
const SINGLE_POINT_ZOOM = 7;
const SINGLE_POINT_EPSILON = 1e-6;

const BASEMAP_SOURCES = [
  { id: "basemap-countries", url: "/basemap/countries.geojson" },
  { id: "basemap-provinces", url: "/basemap/provinces.geojson" },
  { id: "basemap-rivers", url: "/basemap/rivers.geojson" },
  { id: "basemap-lakes", url: "/basemap/lakes.geojson" },
] as const;

const INTERACTIVE_LAYER_IDS = [
  ...ROUTE_LAYER_IDS,
  "route-arrow",
  "control-fill",
  "frontline",
] as const;

const LAYER_SELECTION_TYPES: Record<
  (typeof INTERACTIVE_LAYER_IDS)[number],
  AtlasSelection["type"]
> = {
  "route-line-march": "route",
  "route-line-retreat": "route",
  "route-line-reinforce": "route",
  "route-line-transport": "route",
  "route-arrow": "route",
  "control-fill": "area",
  frontline: "frontline",
};

type AtlasLayerKey =
  | "control"
  | "routes"
  | "frontlines"
  | "provinces"
  | "labels"
  | "routeLabels";
type AtlasLayerVisibility = Record<AtlasLayerKey, boolean>;

const DEFAULT_LAYER_VISIBILITY: AtlasLayerVisibility = {
  control: true,
  routes: true,
  frontlines: true,
  provinces: true,
  labels: true,
  routeLabels: true,
};

const LAYER_OPTIONS: {
  key: AtlasLayerKey;
  label: string;
  hint: string;
}[] = [
  { key: "control", label: "势力范围", hint: "控制区（示意图）" },
  { key: "routes", label: "路线", hint: "行军/退却线与箭头" },
  { key: "frontlines", label: "对峙线", hint: "双方接触示意线" },
  { key: "provinces", label: "省界", hint: "离线底图省界虚线" },
  { key: "labels", label: "地名标签", hint: "地点名称；重叠时自动隐藏，悬停点位看详情" },
  {
    key: "routeLabels",
    label: "路线标注",
    hint: "谁统领、从哪到哪；重叠时自动隐藏，悬停线条看原文",
  },
];

type AtlasMapStyle = Exclude<NonNullable<MapOptions["style"]>, string>;

interface DataSourceLike {
  setData(data: unknown): Promise<void> | void;
}

function buildMapStyle(): AtlasMapStyle {
  return {
    version: 8,
    name: "history-atlas-paper",
    sources: {
      "basemap-countries": {
        type: "geojson",
        data: "/basemap/countries.geojson",
      },
      "basemap-provinces": {
        type: "geojson",
        data: "/basemap/provinces.geojson",
      },
      "basemap-rivers": {
        type: "geojson",
        data: "/basemap/rivers.geojson",
      },
      "basemap-lakes": {
        type: "geojson",
        data: "/basemap/lakes.geojson",
      },
      "atlas-accuracy": { type: "geojson", data: emptyFeatureCollection() },
      "atlas-control": { type: "geojson", data: emptyFeatureCollection() },
      "atlas-frontline": { type: "geojson", data: emptyFeatureCollection() },
      "atlas-frontline-ticks": {
        type: "geojson",
        data: emptyFeatureCollection(),
      },
      "atlas-route": { type: "geojson", data: emptyFeatureCollection() },
      "atlas-route-arrow": { type: "geojson", data: emptyFeatureCollection() },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#f4ead5" },
      },
      {
        id: "basemap-land",
        type: "fill",
        source: "basemap-countries",
        paint: { "fill-color": "#efe4cc", "fill-opacity": 1 },
      },
      {
        id: "basemap-lakes",
        type: "fill",
        source: "basemap-lakes",
        paint: { "fill-color": "#c8dce0" },
      },
      {
        id: "basemap-rivers",
        type: "line",
        source: "basemap-rivers",
        paint: { "line-color": "#8fb3bd", "line-width": 0.8 },
      },
      {
        id: "basemap-provinces",
        type: "line",
        source: "basemap-provinces",
        paint: {
          "line-color": "#b9a98c",
          "line-width": 0.8,
          "line-dasharray": [3, 3],
        },
      },
      {
        id: "basemap-country-outline",
        type: "line",
        source: "basemap-countries",
        paint: { "line-color": "#8a7a5f", "line-width": 1.1 },
      },
      {
        id: "place-accuracy-fill",
        type: "fill",
        source: "atlas-accuracy",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.07,
        },
      },
      {
        id: "place-accuracy-outline",
        type: "line",
        source: "atlas-accuracy",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1,
          "line-dasharray": [2, 2],
          "line-opacity": 0.7,
        },
      },
      {
        id: "control-fill",
        type: "fill",
        source: "atlas-control",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.12,
        },
      },
      {
        id: "control-hatch",
        type: "fill",
        source: "atlas-control",
        paint: {
          "fill-pattern": CONTROL_HATCH_ID,
          "fill-opacity": 0.34,
        },
      },
      {
        id: "control-outline",
        type: "line",
        source: "atlas-control",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.4,
          "line-opacity": 0.85,
        },
      },
      {
        id: "frontline-band",
        type: "line",
        source: "atlas-frontline",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#9b2c2c",
          "line-width": 16,
          "line-opacity": 0.06,
          "line-blur": 3,
        },
      },
      {
        id: "frontline",
        type: "line",
        source: "atlas-frontline",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#9b2c2c",
          "line-width": 2,
          "line-dasharray": [2, 1.5],
        },
      },
      {
        id: "frontline-ticks",
        type: "line",
        source: "atlas-frontline-ticks",
        paint: {
          "line-color": "#9b2c2c",
          "line-width": 1.1,
          "line-opacity": 0.55,
        },
      },
      {
        id: "route-line-march",
        type: "line",
        source: "atlas-route",
        filter: ["==", ["get", "effect"], "march"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.6,
          "line-opacity": 0.9,
        },
      },
      {
        id: "route-line-retreat",
        type: "line",
        source: "atlas-route",
        filter: ["==", ["get", "effect"], "retreat"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.3,
          "line-opacity": 0.9,
          "line-dasharray": [2, 2],
        },
      },
      {
        id: "route-line-reinforce",
        type: "line",
        source: "atlas-route",
        filter: ["==", ["get", "effect"], "reinforce"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.2,
          "line-opacity": 0.9,
          "line-dasharray": [7, 2],
        },
      },
      {
        id: "route-line-transport",
        type: "line",
        source: "atlas-route",
        filter: ["==", ["get", "effect"], "transport"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.9,
          "line-dasharray": [1, 3],
        },
      },
      {
        id: "route-arrow",
        type: "symbol",
        source: "atlas-route-arrow",
        layout: {
          "icon-image": ARROW_IMAGE_ID,
          "icon-size": 0.55,
          "icon-rotate": ["get", "angle"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-opacity": 0.95,
        },
      },
    ],
  };
}

function createArrowImage(): ImageData | null {
  if (typeof document === "undefined") return null;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.clearRect(0, 0, size, size);
  context.translate(size / 2, size / 2);
  context.beginPath();
  context.moveTo(0, -12);
  context.lineTo(7, 8);
  context.lineTo(0, 3);
  context.lineTo(-7, 8);
  context.closePath();
  context.fillStyle = "#ffffff";
  context.fill();
  return context.getImageData(0, 0, size, size);
}

function createControlHatchImage(): ImageData | null {
  if (typeof document === "undefined") return null;
  const size = 14;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, size, size);
  context.strokeStyle = "rgba(96,77,49,0.28)";
  context.lineWidth = 1;
  for (let offset = -size; offset < size * 2; offset += 7) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + size, size);
    context.stroke();
  }
  return context.getImageData(0, 0, size, size);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function setSourceData(
  map: MapLibreMap,
  sourceId: string,
  data: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
  if (!map.getSource(sourceId)) return;
  const source = map.getSource(sourceId) as unknown as
    | DataSourceLike
    | undefined;
  if (!source || typeof source.setData !== "function") return;
  try {
    void Promise.resolve(source.setData(data)).catch(() => undefined);
  } catch {
    // The style may still be settling; the next data effect retries.
  }
}

function reloadSource(map: MapLibreMap, sourceId: string, url: string): void {
  const source = map.getSource(sourceId) as unknown as
    | DataSourceLike
    | undefined;
  if (!source || typeof source.setData !== "function") return;
  try {
    void Promise.resolve(source.setData(url)).catch(() => undefined);
  } catch {
    // Retry is best-effort; the basemap banner stays visible.
  }
}

function setPaint(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  if (!map.getLayer(layerId)) return;
  map.setPaintProperty(layerId, property as never, value as never);
}


function setLayout(
  map: MapLibreMap,
  layerId: string,
  property: string,
  value: unknown,
): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, property as never, value as never);
}

function setLayerVisibility(
  map: MapLibreMap,
  layerId: string,
  visible: boolean,
): void {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function createPlaceMarkerElement(
  place: Place,
  color: string,
  uncertain: boolean,
  effect: ReturnType<typeof placeEffect>,
  onSelect: () => void,
  onHover: (event: MouseEvent) => void,
  onLeave: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.placeId = place.id;
  button.setAttribute(
    "aria-label",
    `${place.name}${uncertain ? "，定位存疑" : ""}`,
  );
  button.title = uncertain ? `${place.name}（定位待考/低置信）` : place.name;
  button.dataset.effect = effect.kind;
  button.style.zIndex = "4";
  button.style.cssText = [
    "display:inline-flex",
    "flex-direction:column",
    "align-items:center",
    "gap:2px",
    "padding:0 0 6px",
    "border:0",
    "background:transparent",
    "color:#241f18",
    "cursor:pointer",
    "font:inherit",
    "pointer-events:auto",
    "transform:translateY(-1px)",
  ].join(";");

  const label = document.createElement("span");
  label.dataset.atlasLabel = "true";
  label.textContent =
    effect.kind === "city" ? place.name : `${effect.glyph} ${place.name}`;
  label.style.cssText = [
    "display:block",
    "max-width:9rem",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "white-space:nowrap",
    "padding:1px 5px",
    "border:1px solid rgba(138,122,95,.55)",
    `border-style:${uncertain ? "dashed" : "solid"}`,
    "border-radius:3px",
    "background:rgba(255,252,244,.92)",
    "color:#241f18",
    "font-family:'Songti SC','Noto Serif CJK SC','Source Han Serif SC',serif",
    "font-size:11px",
    "line-height:1.5",
    "letter-spacing:.02em",
    "box-shadow:0 1px 3px rgba(66,53,33,.18)",
  ].join(";");

  const dot = document.createElement("span");
  dot.dataset.atlasDot = "true";
  dot.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:-4px",
    "width:9px",
    "height:9px",
    "border-radius:999px",
    `background:${color}`,
    "transform:translateX(-50%)",
    "box-shadow:0 0 0 1px rgba(255,252,244,.95),0 1px 2px rgba(36,31,24,.35)",
  ].join(";");

  if (effect.pulse) {
    const ring = document.createElement("span");
    ring.dataset.atlasPulse = "true";
    ring.className = "atlas-marker-pulse";
    ring.style.borderColor = color;
    button.append(ring);
  }

  button.append(label, dot);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
  });
  button.addEventListener("mouseenter", (event) => {
    label.style.background = "rgba(255,253,248,1)";
    label.style.borderColor = "rgba(155,44,44,.65)";
    label.style.fontWeight = "600";
    onHover(event);
  });
  button.addEventListener("mousemove", onHover);
  button.addEventListener("mouseleave", () => {
    label.style.fontWeight = "";
    if (label.dataset.selected !== "true") {
      label.style.background = "rgba(255,252,244,.92)";
      label.style.borderColor = "rgba(138,122,95,.55)";
    }
    onLeave();
  });

  return button;
}

function createRouteLabelElement(input: {
  routeId: string;
  text: string;
  color: string;
  effectGlyph: string;
  onSelect: () => void;
  onHover: (event: MouseEvent) => void;
  onLeave: () => void;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.routeLabel = input.routeId;
  button.style.zIndex = "2";
  button.title = input.text;
  button.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:3px",
    "max-width:11rem",
    "padding:2px 6px",
    "border:1px solid rgba(138,122,95,.45)",
    "border-left:3px solid " + input.color,
    "border-radius:3px",
    "background:rgba(255,252,244,.9)",
    "color:#3b3429",
    "font:10px/1.45 'Songti SC','Noto Serif CJK SC','Source Han Serif SC',serif",
    "letter-spacing:.01em",
    "box-shadow:0 1px 3px rgba(66,53,33,.14)",
    "cursor:pointer",
    "pointer-events:auto",
    "white-space:nowrap",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "transition:transform .15s ease,background .15s ease",
  ].join(";");
  const glyph = document.createElement("span");
  glyph.textContent = input.effectGlyph;
  glyph.style.cssText = `color:${input.color};font-weight:700;flex:none`;
  const label = document.createElement("span");
  label.textContent = input.text;
  label.style.cssText = "overflow:hidden;text-overflow:ellipsis";
  button.append(glyph, label);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.onSelect();
  });
  button.addEventListener("mouseenter", (event) => {
    button.style.background = "#fffdf8";
    input.onHover(event);
  });
  button.addEventListener("mousemove", input.onHover);
  button.addEventListener("mouseleave", () => {
    button.style.background = "rgba(255,252,244,.9)";
    input.onLeave();
  });
  return button;
}

function createFrontLineLabelElement(input: {
  text: string;
  onSelect: () => void;
  onHover: (event: MouseEvent) => void;
  onLeave: () => void;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.frontlineLabel = "true";
  button.style.zIndex = "2";
  button.textContent = `‖ ${input.text}`;
  button.title = "战略对峙线（示意）";
  button.style.cssText = [
    "padding:2px 7px",
    "border:1px dashed rgba(155,44,44,.65)",
    "border-radius:999px",
    "background:rgba(255,248,238,.92)",
    "color:#7d2424",
    "font:10px/1.45 'Songti SC','Noto Serif CJK SC','Source Han Serif SC',serif",
    "letter-spacing:.04em",
    "cursor:pointer",
    "pointer-events:auto",
    "box-shadow:0 1px 3px rgba(66,53,33,.14)",
  ].join(";");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.onSelect();
  });
  button.addEventListener("mouseenter", input.onHover);
  button.addEventListener("mousemove", input.onHover);
  button.addEventListener("mouseleave", input.onLeave);
  return button;
}

function applyMarkerSelection(
  element: HTMLButtonElement,
  selected: boolean,
): void {
  const label = element.querySelector<HTMLElement>(
    '[data-atlas-label="true"]',
  );
  const dot = element.querySelector<HTMLElement>('[data-atlas-dot="true"]');
  if (!label) return;
  label.dataset.selected = selected ? "true" : "false";
  label.style.background = selected ? "#9b2c2c" : "rgba(255,252,244,.92)";
  label.style.color = selected ? "#fff8ea" : "#241f18";
  label.style.borderColor = selected ? "#7d2424" : "rgba(138,122,95,.55)";
  if (dot) {
    dot.style.boxShadow = selected
      ? "0 0 0 2px #f7f1e3,0 0 0 4px rgba(155,44,44,.6)"
      : "0 0 0 1px rgba(255,252,244,.95),0 1px 2px rgba(36,31,24,.35)";
  }
  element.style.zIndex = selected ? "6" : "4";
}

function LegendRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-xs text-ink-soft">
      {children}
    </li>
  );
}

export interface AtlasMapProps {
  analysis: Analysis;
  activeSceneIndex: number;
  selectedFeature: AtlasSelection | null;
  onSelectFeature(feature: AtlasSelection | null): void;
  correctingPlaceId?: string | null;
  onCorrectLocation?(input: {
    placeId: string;
    lng: number;
    lat: number;
  }): void;
  onCancelCorrection?(): void;
  className?: string;
}

export function AtlasMap({
  analysis,
  activeSceneIndex,
  selectedFeature,
  onSelectFeature,
  correctingPlaceId,
  onCorrectLocation,
  onCancelCorrection,
  className,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const maplibreRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markerElementsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const routeLabelElementsRef = useRef<Map<string, HTMLButtonElement>>(
    new Map(),
  );
  const frontLineLabelElementsRef = useRef<HTMLButtonElement[]>([]);
  const lastFitKeyRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [basemapMissing, setBasemapMissing] = useState<string[]>([]);
  const [basemapRetry, setBasemapRetry] = useState(0);
  const [visibility, setVisibility] = useState<AtlasLayerVisibility>(
    DEFAULT_LAYER_VISIBILITY,
  );
  const [hoveredFeature, setHoveredFeature] =
    useState<AtlasSelection | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    kicker: string;
    title: string;
    subtitle?: string;
    quote?: string;
  } | null>(null);

  const scene = useMemo(
    () => getScene(analysis, activeSceneIndex),
    [analysis, activeSceneIndex],
  );
  const places = useMemo(() => scenePlaces(analysis, scene), [analysis, scene]);
  const routes = useMemo(
    () => sceneRoutes(analysis, scene),
    [analysis, scene],
  );
  const routeData = useMemo(
    () => routeFeatureCollection(analysis, scene),
    [analysis, scene],
  );
  const arrowData = useMemo(
    () =>
      arrowFeatures(
        routes,
        analysis.situation.places,
        analysis.situation.factions,
      ),
    [routes, analysis.situation.places, analysis.situation.factions],
  );
  const areaData = useMemo(
    () => areaFeatureCollection(analysis, scene),
    [analysis, scene],
  );
  const frontLineData = useMemo(
    () => frontLineFeatureCollection(analysis, scene),
    [analysis, scene],
  );
  const frontLineTicks = useMemo(
    () => frontLineTickCollection(analysis, scene),
    [analysis, scene],
  );
  const accuracyData = useMemo(
    () => placeAccuracyFeatureCollection(analysis, scene),
    [analysis, scene],
  );
  const bounds = useMemo(
    () => featureBounds(analysis, activeSceneIndex),
    [analysis, activeSceneIndex],
  );
  const correctingPlace = useMemo(
    () =>
      analysis.situation.places.find(
        (place) => place.id === correctingPlaceId,
      ) ?? null,
    [analysis.situation.places, correctingPlaceId],
  );

  const citationById = useMemo(
    () =>
      new Map(
        analysis.situation.citations.map((citation) => [
          citation.id,
          citation,
        ]),
      ),
    [analysis.situation.citations],
  );

  const quoteFor = useCallback(
    (evidenceIds: readonly string[]): string | undefined => {
      for (const id of evidenceIds) {
        const quote = citationById.get(id)?.quote?.trim();
        if (quote) {
          return quote.length > 220 ? `${quote.slice(0, 218)}…` : quote;
        }
      }
      return undefined;
    },
    [citationById],
  );

  const showHover = useCallback(
    (feature: AtlasSelection, point: { x: number; y: number }) => {
      const situation = analysis.situation;
      let kicker = "";
      let title = "";
      let subtitle: string | undefined;
      let quote: string | undefined;

      if (feature.type === "place") {
        const place = situation.places.find((item) => item.id === feature.id);
        if (!place) return;
        const preset = placeEffect(place);
        const faction = situation.factions.find(
          (item) => item.id === place.factionId,
        );
        kicker = `${preset.label}${faction ? ` · ${faction.name}` : ""}`;
        title = place.name;
        subtitle = [
          place.modernName ? `今 ${place.modernName}` : null,
          place.role,
        ]
          .filter(Boolean)
          .join(" · ");
        quote = quoteFor(place.evidence);
      } else if (feature.type === "route") {
        const route = situation.routes.find((item) => item.id === feature.id);
        if (!route) return;
        const from = situation.places.find(
          (item) => item.id === route.fromPlaceId,
        );
        const to = situation.places.find(
          (item) => item.id === route.toPlaceId,
        );
        const faction = situation.factions.find(
          (item) => item.id === route.factionId,
        );
        const preset = routeEffect(route.kind);
        kicker = `${preset.label}${faction ? ` · ${faction.name}` : ""}`;
        title =
          route.label ||
          `${from?.name ?? route.fromPlaceId} → ${to?.name ?? route.toPlaceId}`;
        subtitle = `${from?.name ?? "?"} → ${to?.name ?? "?"}`;
        quote = quoteFor(route.evidence);
      } else if (feature.type === "area") {
        const area = situation.controlAreas.find(
          (item) => item.id === feature.id,
        );
        if (!area) return;
        const faction = situation.factions.find(
          (item) => item.id === area.factionId,
        );
        kicker = "势力范围（示意）";
        title = area.name;
        subtitle = faction?.name;
        quote = quoteFor(area.evidence);
      } else if (feature.type === "frontline") {
        const line = situation.frontLines.find(
          (item) => item.id === feature.id,
        );
        if (!line) return;
        const names = line.factionIds
          .map(
            (id) => situation.factions.find((faction) => faction.id === id)?.name,
          )
          .filter((name): name is string => Boolean(name));
        kicker = "战略对峙";
        title = line.name ?? "对峙线";
        subtitle = names.join(" / ");
        quote = quoteFor(line.evidence);
      }

      const container = containerRef.current;
      const width = container?.clientWidth ?? 600;
      const height = container?.clientHeight ?? 400;
      setHoveredFeature(feature);
      setTooltip({
        x: Math.min(Math.max(12, point.x + 14), Math.max(12, width - 296)),
        y: Math.min(Math.max(12, point.y + 14), Math.max(12, height - 240)),
        kicker,
        title,
        subtitle: subtitle || undefined,
        quote,
      });
    },
    [analysis.situation, quoteFor],
  );

  const clearHover = useCallback(() => {
    setHoveredFeature(null);
    setTooltip(null);
  }, []);

  const resolveLabelCollisions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    type Candidate = {
      element: HTMLElement;
      rect: DOMRect;
      priority: number;
      hide: () => void;
    };
    const candidates: Candidate[] = [];

    for (const element of markerElementsRef.current.values()) {
      if (!visibility.labels) continue;
      const label = element.querySelector<HTMLElement>(
        '[data-atlas-label="true"]',
      );
      if (!label) continue;
      label.style.display = "";
      const rect = label.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const selected =
        selectedFeature?.type === "place" &&
        selectedFeature.id === element.dataset.placeId;
      const effect = element.dataset.effect ?? "city";
      const emergency = ["battle", "siege", "ambush"].includes(effect);
      const important = ["camp", "pass"].includes(effect);
      candidates.push({
        element: label,
        rect,
        priority: selected ? 1000 : emergency ? 120 : important ? 90 : 60,
        hide: () => {
          // display:none removes the label's hit area too; visibility:hidden
          // left an invisible button that still captured hover/click/focus.
          label.style.display = "none";
        },
      });
    }

    for (const [id, element] of routeLabelElementsRef.current) {
      if (!visibility.routeLabels) continue;
      element.style.display = "inline-flex";
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      candidates.push({
        element,
        rect,
        priority: 40,
        hide: () => {
          element.style.display = "none";
        },
      });
      void id;
    }

    for (const element of frontLineLabelElementsRef.current) {
      if (!visibility.frontlines) continue;
      element.style.display = "inline-flex";
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      candidates.push({
        element,
        rect,
        priority: 80,
        hide: () => {
          element.style.display = "none";
        },
      });
    }

    const overlaps = (a: DOMRect, b: DOMRect): boolean =>
      !(
        a.right + 4 <= b.left ||
        b.right + 4 <= a.left ||
        a.bottom + 4 <= b.top ||
        b.bottom + 4 <= a.top
      );

    const accepted: DOMRect[] = [];
    candidates
      .sort((a, b) => b.priority - a.priority)
      .forEach((candidate) => {
        if (
          candidate.rect.left > containerRect.right ||
          candidate.rect.right < containerRect.left ||
          candidate.rect.top > containerRect.bottom ||
          candidate.rect.bottom < containerRect.top
        ) {
          return;
        }
        if (accepted.some((rect) => overlaps(rect, candidate.rect))) {
          candidate.hide();
          return;
        }
        accepted.push(candidate.rect);
      });
  }, [
    selectedFeature,
    visibility.frontlines,
    visibility.labels,
    visibility.routeLabels,
  ]);

  const handlersRef = useRef({
    onSelectFeature,
    onCorrectLocation,
    correctingPlaceId,
    onHoverFeature: showHover,
    onClearHover: clearHover,
  });
  useEffect(() => {
    handlersRef.current = {
      onSelectFeature,
      onCorrectLocation,
      correctingPlaceId,
      onHoverFeature: showHover,
      onClearHover: clearHover,
    };
  }, [onSelectFeature, onCorrectLocation, correctingPlaceId, showHover, clearHover]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let markedReady = false;
    let localMap: MapLibreMap | null = null;
    const subscriptions: Subscription[] = [];
    const arrowImage = createArrowImage();
    const controlHatchImage = createControlHatchImage();

    const markReady = () => {
      if (cancelled || markedReady) return;
      markedReady = true;
      setReady(true);
    };

    const init = async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        if (cancelled) return;
        maplibreRef.current = maplibregl;
        // Turbopack does not emit a usable worker URL for MapLibre; load the
        // self-contained worker copied by scripts/copy-maplibre-worker.mjs.
        maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

        const map = new maplibregl.Map({
          container,
          style: buildMapStyle(),
          center: [...MAP_INITIAL_CENTER],
          zoom: MAP_INITIAL_ZOOM,
          minZoom: 2,
          maxZoom: MAP_MAX_ZOOM,
          renderWorldCopies: false,
          dragRotate: false,
          touchPitch: false,
          fadeDuration: 0,
          maplibreLogo: false,
          attributionControl: {
            compact: true,
            customAttribution: "Natural Earth / MapLibre",
          },
        });

        localMap = map;
        mapRef.current = map;

        const addImages = () => {
          if (arrowImage && !map.hasImage(ARROW_IMAGE_ID)) {
            try {
              map.addImage(ARROW_IMAGE_ID, arrowImage, { sdf: true });
            } catch {
              // Style is not ready yet; the style.load handler will retry.
            }
          }
          if (controlHatchImage && !map.hasImage(CONTROL_HATCH_ID)) {
            try {
              map.addImage(CONTROL_HATCH_ID, controlHatchImage);
            } catch {
              // Style is not ready yet; the style.load handler will retry.
            }
          }
        };

        subscriptions.push(
          map.on("style.load", () => {
            addImages();
            markReady();
          }),
        );
        subscriptions.push(
          map.on("styleimagemissing", (event) => {
            if (event.id === ARROW_IMAGE_ID || event.id === CONTROL_HATCH_ID) {
              addImages();
            }
          }),
        );
        subscriptions.push(
          map.on("load", () => {
            addImages();
            markReady();
          }),
        );
        subscriptions.push(map.on("idle", markReady));
        subscriptions.push(
          map.on("error", (event) => {
            const error = event.error as { message?: string; url?: string };
            const message = error.message ?? "";
            const url = error.url ?? "";
            if (/basemap/i.test(message) || /basemap/i.test(url)) {
              setBasemapMissing((previous) =>
                previous.length > 0 ? previous : ["/basemap/*.geojson"],
              );
            }
          }),
        );

        subscriptions.push(
          map.on("mousemove", (event) => {
            const canvas = map.getCanvas();
            const active = handlersRef.current;
            if (active.correctingPlaceId) {
              canvas.style.cursor = "crosshair";
              active.onClearHover();
              return;
            }
            const activeLayers = INTERACTIVE_LAYER_IDS.filter((id) =>
              Boolean(map.getLayer(id)),
            );
            const hits = activeLayers.length
              ? map.queryRenderedFeatures(event.point, {
                  layers: [...activeLayers],
                })
              : [];
            canvas.style.cursor = hits.length > 0 ? "pointer" : "";
            const hit = hits[0];
            if (!hit) {
              // MapLibre receives mousemove events bubbling from HTML markers;
              // do not clear a marker tooltip just because no map layer is under
              // the cursor. CSS :hover tells us a marker label owns the pointer.
              if (!document.querySelector(".maplibregl-marker:hover")) {
                active.onClearHover();
              }
              return;
            }
            const rawId = hit.properties?.id;
            const id = typeof rawId === "string" ? rawId : "";
            const layerId = hit.layer.id as
              | (typeof INTERACTIVE_LAYER_IDS)[number]
              | string;
            const type =
              LAYER_SELECTION_TYPES[
                layerId as keyof typeof LAYER_SELECTION_TYPES
              ];
            if (!id || !type) {
              if (!document.querySelector(".maplibregl-marker:hover")) {
                active.onClearHover();
              }
              return;
            }
            active.onHoverFeature(
              { type, id },
              { x: event.point.x, y: event.point.y },
            );
          }),
        );

        subscriptions.push(
          map.on("mouseout", () => {
            map.getCanvas().style.cursor = "";
          }),
        );
        subscriptions.push(map.on("movestart", () => handlersRef.current.onClearHover()));
        subscriptions.push(map.on("zoomstart", () => handlersRef.current.onClearHover()));

        subscriptions.push(
          map.on("click", (event: MapMouseEvent) => {
            const active = handlersRef.current;
            if (active.correctingPlaceId) {
              active.onCorrectLocation?.({
                placeId: active.correctingPlaceId,
                lng: event.lngLat.lng,
                lat: event.lngLat.lat,
              });
              return;
            }

            const layers = INTERACTIVE_LAYER_IDS.filter((id) =>
              Boolean(map.getLayer(id)),
            );
            const hits = layers.length
              ? map.queryRenderedFeatures(event.point, { layers: [...layers] })
              : [];
            const hit = hits[0];
            if (!hit) {
              active.onSelectFeature(null);
              return;
            }
            const rawId = hit.properties?.id;
            const id = typeof rawId === "string" ? rawId : "";
            const layerId = hit.layer.id as
              | (typeof INTERACTIVE_LAYER_IDS)[number]
              | string;
            const type =
              LAYER_SELECTION_TYPES[
                layerId as keyof typeof LAYER_SELECTION_TYPES
              ];
            if (!id || !type) {
              active.onSelectFeature(null);
              return;
            }
            active.onSelectFeature({ type, id });
          }),
        );
      } catch (error) {
        if (!cancelled) {
          setFatalError(
            error instanceof Error ? error.message : "地图初始化失败",
          );
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
      if (mapRef.current === localMap) mapRef.current = null;
      maplibreRef.current = null;
      lastFitKeyRef.current = null;
      localMap?.remove();
      // If this effect is re-run for a fresh map (Fast Refresh/StrictMode),
      // flipping readiness back makes the data, marker and fit effects run
      // again for the new instance.
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(map, "atlas-route", routeData);
    setSourceData(map, "atlas-route-arrow", arrowData);
    setSourceData(map, "atlas-control", areaData);
    setSourceData(map, "atlas-frontline", frontLineData);
    setSourceData(map, "atlas-frontline-ticks", frontLineTicks);
    setSourceData(map, "atlas-accuracy", accuracyData);
  }, [
    ready,
    routeData,
    arrowData,
    areaData,
    frontLineData,
    frontLineTicks,
    accuracyData,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (ids: readonly string[], visible: boolean) => {
      for (const id of ids) setLayerVisibility(map, id, visible);
    };
    set(
      ["control-fill", "control-hatch", "control-outline"],
      visibility.control,
    );
    set([...ROUTE_LAYER_IDS, "route-arrow"], visibility.routes);
    set(["frontline-band", "frontline", "frontline-ticks"], visibility.frontlines);
    set(["basemap-provinces"], visibility.provinces);
  }, [ready, visibility]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !ready) return;

    const createdMarkers: MapLibreMarker[] = [];
    const createdElements: [string, HTMLButtonElement][] = [];
    const elementMap = markerElementsRef.current;

    const hoverPoint = (event: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return rect
        ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
        : { x: 0, y: 0 };
    };

    for (const place of places) {
      if (!place.location) continue;
      const element = createPlaceMarkerElement(
        place,
        factionColor(analysis.situation.factions, place.factionId),
        isLowConfidence(place),
        placeEffect(place),
        () => {
          const active = handlersRef.current;
          if (active.correctingPlaceId) return;
          active.onSelectFeature({ type: "place", id: place.id });
        },
        (event) => showHover({ type: "place", id: place.id }, hoverPoint(event)),
        clearHover,
      );
      const marker = new maplibregl.Marker({
        element,
        anchor: "bottom",
      })
        .setLngLat([place.location.lng, place.location.lat])
        .addTo(map);
      createdMarkers.push(marker);
      createdElements.push([place.id, element]);
      elementMap.set(place.id, element);
    }

    return () => {
      for (const marker of createdMarkers) marker.remove();
      for (const [placeId] of createdElements) {
        elementMap.delete(placeId);
      }
    };
  }, [ready, places, analysis.situation.factions, showHover, clearHover]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !ready) return;

    const createdMarkers: MapLibreMarker[] = [];
    const elements = routeLabelElementsRef.current;
    const placeById = new Map(
      analysis.situation.places.map((place) => [place.id, place] as const),
    );
    const factionName = new Map(
      analysis.situation.factions.map((faction) => [
        faction.id,
        faction.name,
      ] as const),
    );
    const isOverview =
      scene?.id === "s-overview" || Boolean(scene?.title.includes("概览"));
    // The overview intentionally keeps only lines + hover tooltips; four
    // labels at this zoom overlap and hide the actual map. Specific scenes are
    // zoomed enough for route labels to be useful.
    const labelLimit = isOverview ? 0 : 6;
    const labelRoutes = visibility.routeLabels
      ? routes.slice(0, labelLimit)
      : [];

    for (const [routeIndex, route] of labelRoutes.entries()) {
      const from = placeById.get(route.fromPlaceId);
      const to = placeById.get(route.toPlaceId);
      if (!from?.location || !to?.location) continue;
      const preset = routeEffect(route.kind);
      const labelFraction = 0.32 + (routeIndex % 4) * 0.13;
      const labelPoint = curvedPointAt(
        [from.location.lng, from.location.lat],
        [to.location.lng, to.location.lat],
        route.id,
        labelFraction,
      );
      const color = factionColor(
        analysis.situation.factions,
        route.factionId,
      );
      const text =
        route.label?.trim() ||
        `${from.name} → ${to.name}${route.factionId ? `（${factionName.get(route.factionId) ?? ""}）` : ""}`;
      const element = createRouteLabelElement({
        routeId: route.id,
        text,
        color,
        effectGlyph: preset.glyph,
        onSelect: () => {
          const active = handlersRef.current;
          if (active.correctingPlaceId) return;
          active.onSelectFeature({ type: "route", id: route.id });
        },
        onHover: (event) => {
          const rect = containerRef.current?.getBoundingClientRect();
          showHover(
            { type: "route", id: route.id },
            {
              x: rect ? event.clientX - rect.left : 0,
              y: rect ? event.clientY - rect.top : 0,
            },
          );
        },
        onLeave: clearHover,
      });
      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
        offset: [0, routeIndex % 2 === 0 ? -20 : 20],
      })
        .setLngLat([labelPoint[0], labelPoint[1]])
        .addTo(map);
      createdMarkers.push(marker);
      elements.set(route.id, element);
    }

    return () => {
      for (const marker of createdMarkers) marker.remove();
      for (const id of [...elements.keys()]) {
        if (!routes.some((route) => route.id === id)) elements.delete(id);
      }
    };
  }, [
    ready,
    routes,
    analysis.situation.factions,
    analysis.situation.places,
    scene,
    visibility.routeLabels,
    showHover,
    clearHover,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !ready) return;

    const createdMarkers: MapLibreMarker[] = [];
    const created: HTMLButtonElement[] = [];
    const factionName = new Map(
      analysis.situation.factions.map((faction) => [
        faction.id,
        faction.name,
      ] as const),
    );

    const isOverview =
      scene?.id === "s-overview" || Boolean(scene?.title.includes("概览"));
    for (const line of isOverview ? [] : sceneFrontLines(analysis, scene)) {
      const coords = line.geometry.coordinates;
      if (coords.length === 0) continue;
      const middle = coords[Math.floor(coords.length / 2)] ?? coords[0]!;
      const names = line.factionIds
        .map((id) => factionName.get(id))
        .filter((name): name is string => Boolean(name));
      const element = createFrontLineLabelElement({
        text: line.name ?? (names.join(" / ") || "对峙"),
        onSelect: () => {
          const active = handlersRef.current;
          if (active.correctingPlaceId) return;
          active.onSelectFeature({ type: "frontline", id: line.id });
        },
        onHover: (event) => {
          const rect = containerRef.current?.getBoundingClientRect();
          showHover(
            { type: "frontline", id: line.id },
            {
              x: rect ? event.clientX - rect.left : 0,
              y: rect ? event.clientY - rect.top : 0,
            },
          );
        },
        onLeave: clearHover,
      });
      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
        offset: [0, -22],
      })
        .setLngLat([middle[0], middle[1]])
        .addTo(map);
      createdMarkers.push(marker);
      created.push(element);
    }

    frontLineLabelElementsRef.current = created;
    return () => {
      for (const marker of createdMarkers) marker.remove();
      frontLineLabelElementsRef.current = [];
    };
  }, [
    ready,
    analysis,
    analysis.situation.factions,
    scene,
    showHover,
    clearHover,
  ]);

  useEffect(() => {
    const elements = markerElementsRef.current;
    for (const [placeId, element] of elements) {
      applyMarkerSelection(
        element,
        selectedFeature?.type === "place" && selectedFeature.id === placeId,
      );
    }
  }, [selectedFeature, ready, places]);

  useEffect(() => {
    for (const element of markerElementsRef.current.values()) {
      const label = element.querySelector<HTMLElement>('[data-atlas-label="true"]');
      if (label) {
        label.style.visibility = visibility.labels ? "visible" : "hidden";
      }
    }
  }, [ready, places, visibility.labels]);

  useEffect(() => {
    for (const element of routeLabelElementsRef.current.values()) {
      element.style.display = visibility.routeLabels ? "inline-flex" : "none";
    }
    for (const element of containerRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-frontline-label="true"]',
    ) ?? []) {
      element.style.display = visibility.frontlines ? "inline-flex" : "none";
    }
  }, [ready, routes, visibility.routeLabels, visibility.frontlines]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let frame = 0;
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        resolveLabelCollisions();
      });
    };
    schedule();
    map.on("moveend", schedule);
    map.on("zoomend", schedule);
    map.on("idle", schedule);
    window.addEventListener("resize", schedule);
    const container = containerRef.current;
    const observer = container ? new ResizeObserver(schedule) : null;
    if (container && observer) observer.observe(container);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      map.off("moveend", schedule);
      map.off("zoomend", schedule);
      map.off("idle", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [ready, resolveLabelCollisions, places, routes, scene, selectedFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const routeId = selectedFeature?.type === "route" ? selectedFeature.id : "";
    const areaId = selectedFeature?.type === "area" ? selectedFeature.id : "";
    const frontLineId =
      selectedFeature?.type === "frontline" ? selectedFeature.id : "";

    const hoveredRouteId =
      hoveredFeature?.type === "route" ? hoveredFeature.id : "";
    const hoveredAreaId =
      hoveredFeature?.type === "area" ? hoveredFeature.id : "";
    const hoveredFrontLineId =
      hoveredFeature?.type === "frontline" ? hoveredFeature.id : "";
    const routeDefaults: Record<(typeof ROUTE_LAYER_IDS)[number], number> = {
      "route-line-march": 2.6,
      "route-line-retreat": 2.3,
      "route-line-reinforce": 2.2,
      "route-line-transport": 2,
    };
    for (const layerId of ROUTE_LAYER_IDS) {
      setPaint(map, layerId, "line-color", [
        "case",
        ["==", ["get", "id"], routeId],
        "#9b2c2c",
        ["==", ["get", "id"], hoveredRouteId],
        "#7d2424",
        ["get", "color"],
      ]);
      setPaint(map, layerId, "line-width", [
        "case",
        ["==", ["get", "id"], routeId],
        4.2,
        ["==", ["get", "id"], hoveredRouteId],
        3.6,
        routeDefaults[layerId],
      ]);
      setPaint(map, layerId, "line-opacity", [
        "case",
        ["==", ["get", "id"], routeId],
        1,
        ["==", ["get", "id"], hoveredRouteId],
        1,
        0.9,
      ]);
    }
    setPaint(map, "route-arrow", "icon-color", [
      "case",
      ["==", ["get", "id"], routeId],
      "#9b2c2c",
      ["==", ["get", "id"], hoveredRouteId],
      "#7d2424",
      ["get", "color"],
    ]);
    setLayout(map, "route-arrow", "icon-size", [
      "case",
      ["==", ["get", "id"], routeId],
      0.72,
      ["==", ["get", "id"], hoveredRouteId],
      0.64,
      0.55,
    ]);
    setPaint(map, "control-fill", "fill-opacity", [
      "case",
      ["==", ["get", "id"], areaId],
      0.3,
      ["==", ["get", "id"], hoveredAreaId],
      0.2,
      0.12,
    ]);
    setPaint(map, "control-outline", "line-color", [
      "case",
      ["==", ["get", "id"], areaId],
      "#9b2c2c",
      ["get", "color"],
    ]);
    setPaint(map, "control-outline", "line-width", [
      "case",
      ["==", ["get", "id"], areaId],
      3,
      ["==", ["get", "id"], hoveredAreaId],
      2.2,
      1.4,
    ]);
    setPaint(map, "frontline", "line-color", [
      "case",
      ["==", ["get", "id"], frontLineId],
      "#7d2424",
      ["get", "color"],
    ]);
    setPaint(map, "frontline", "line-width", [
      "case",
      ["==", ["get", "id"], frontLineId],
      3.4,
      ["==", ["get", "id"], hoveredFrontLineId],
      2.8,
      2,
    ]);
    setPaint(map, "frontline-band", "line-opacity", [
      "case",
      ["==", ["get", "id"], frontLineId],
      0.14,
      ["==", ["get", "id"], hoveredFrontLineId],
      0.11,
      0.06,
    ]);
  }, [ready, selectedFeature, hoveredFeature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const key = `${analysis.id}:${activeSceneIndex}`;
    if (lastFitKeyRef.current === key) return;
    lastFitKeyRef.current = key;
    if (!bounds) return;

    const [west, south, east, north] = bounds;
    const singlePoint =
      Math.abs(east - west) < SINGLE_POINT_EPSILON &&
      Math.abs(north - south) < SINGLE_POINT_EPSILON;
    const reduced = prefersReducedMotion();
    const animate = !reduced;
    const duration = reduced ? 0 : 650;

    if (singlePoint) {
      map.easeTo({
        center: [west, south],
        zoom: SINGLE_POINT_ZOOM,
        animate,
        duration,
      });
      return;
    }

    const box: [number, number, number, number] = [west, south, east, north];
    map.fitBounds(box, {
      padding: { top: 72, bottom: 64, left: 56, right: 56 },
      maxZoom: MAP_MAX_ZOOM,
      animate,
      duration: reduced ? 0 : 750,
    });
  }, [ready, bounds, analysis.id, activeSceneIndex]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = correctingPlaceId ? "crosshair" : "";
    return () => {
      map.getCanvas().style.cursor = "";
    };
  }, [ready, correctingPlaceId]);

  useEffect(() => {
    let cancelled = false;

    const checkBasemap = async () => {
      const results: (string | null)[] = await Promise.all(
        BASEMAP_SOURCES.map(async (source) => {
          try {
            const response = await fetch(source.url, {
              method: "HEAD",
              cache: "no-store",
            });
            return response.ok ? null : source.url;
          } catch {
            return source.url;
          }
        }),
      );
      if (cancelled) return;
      setBasemapMissing(
        results.filter((value): value is string => typeof value === "string"),
      );
    };

    void checkBasemap();
    return () => {
      cancelled = true;
    };
  }, [basemapRetry]);

  const retryBasemap = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      for (const source of BASEMAP_SOURCES) {
        reloadSource(map, source.id, source.url);
      }
    }
    setBasemapRetry((value) => value + 1);
  }, []);

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    lastFitKeyRef.current = null;
    if (bounds) {
      const [west, south, east, north] = bounds;
      const singlePoint =
        Math.abs(east - west) < SINGLE_POINT_EPSILON &&
        Math.abs(north - south) < SINGLE_POINT_EPSILON;
      const reduced = prefersReducedMotion();
      if (singlePoint) {
        map.easeTo({
          center: [west, south],
          zoom: SINGLE_POINT_ZOOM,
          animate: !reduced,
          duration: reduced ? 0 : 650,
        });
      } else {
        map.fitBounds([west, south, east, north], {
          padding: { top: 72, bottom: 64, left: 56, right: 56 },
          maxZoom: MAP_MAX_ZOOM,
          animate: !reduced,
          duration: reduced ? 0 : 750,
        });
      }
    } else {
      map.easeTo({
        center: [...MAP_INITIAL_CENTER],
        zoom: MAP_INITIAL_ZOOM,
        animate: !prefersReducedMotion(),
        duration: 500,
      });
    }
  }, [bounds]);

  const factions = analysis.situation.factions;

  return (
    <div
      className={cn(
        "map-paper relative isolate min-h-[22rem] w-full overflow-hidden border border-line/70",
        className,
      )}
      onMouseLeave={clearHover}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0 }}
        role="region"
        aria-label="历史舆图地图"
      />

      {!ready && !fatalError ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center bg-[#f4ead5]/80">
          <span className="flex items-center gap-2 rounded-sm border border-line/70 bg-surface/90 px-3 py-2 text-xs text-ink-soft">
            <Spinner className="text-cinnabar" />
            正在展开舆图…
          </span>
        </div>
      ) : null}

      {ready ? (
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
          <div className="pointer-events-auto flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className="chip max-w-full overflow-hidden bg-surface/90">
              {scene?.title ?? "全篇"}
            </span>
            {scene?.timeLabel ? (
              <span className="chip hidden bg-surface/80 sm:inline-flex">
                {scene.timeLabel}
              </span>
            ) : null}
            {scene &&
            (scene.id === "s-overview" || scene.title.includes("概览")) &&
            routes.length > 0 ? (
              <span className="chip hidden bg-surface/80 md:inline-flex">
                悬停路线看统领
              </span>
            ) : null}
            {!bounds ? (
              <span className="chip chip-solid">本幕暂无已定位要素</span>
            ) : null}
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="whitespace-nowrap bg-surface/90"
              onClick={resetView}
              title="回到当前幕范围"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">复位</span>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap bg-surface/90"
                >
                  <Layers className="h-3.5 w-3.5" aria-hidden />
                  图层
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="max-h-[min(32rem,75vh)] w-80 overflow-y-auto"
              >
                <p className="font-serif text-sm text-ink">图层与图例</p>
                <p className="mt-1 text-[11px] leading-5 text-ink-faint">
                  离线底图 Natural Earth；中文地名由 HTML 标注，不依赖字体切片。
                </p>

                <div className="mt-3 space-y-2.5">
                  {LAYER_OPTIONS.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-center justify-between gap-3"
                    >
                      <div>
                        <label
                          htmlFor={`atlas-layer-${option.key}`}
                          className="text-xs text-ink"
                        >
                          {option.label}
                        </label>
                        <p className="text-[10px] text-ink-faint">
                          {option.hint}
                        </p>
                      </div>
                      <Switch
                        id={`atlas-layer-${option.key}`}
                        checked={visibility[option.key]}
                        aria-label={option.label}
                        onCheckedChange={(checked) =>
                          setVisibility((previous) => ({
                            ...previous,
                            [option.key]: checked,
                          }))
                        }
                      />
                    </div>
                  ))}

                  <div className="flex items-center justify-between gap-3 border-t border-line/60 pt-2.5">
                    <div>
                      <span className="text-xs text-ink">现代地名</span>
                      <p className="text-[10px] text-ink-faint">
                        公开地名数据尚未接入，开关暂不加载假数据。
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="muted">未接入</Badge>
                      <Switch
                        checked={false}
                        disabled
                        aria-label="现代地名，尚未接入"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-line/60 pt-3">
                  <p className="text-[11px] tracking-[0.18em] text-ink-faint">
                    图例
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {factions.map((faction) => (
                      <li
                        key={faction.id}
                        className="flex items-center gap-2 text-xs text-ink-soft"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: faction.color }}
                        />
                        {faction.name}
                      </li>
                    ))}
                    <LegendRow>
                      <span className="h-3 w-8 shrink-0 border border-dashed border-cinnabar/70 bg-cinnabar/10" />
                      势力范围（斜纹示意）
                    </LegendRow>
                    <LegendRow>
                      <span className="h-3.5 w-8 shrink-0 rounded-full border border-dashed border-ink-faint/80" />
                      定位误差圈
                    </LegendRow>
                    <li className="pt-2 text-[10px] tracking-[0.18em] text-ink-faint">
                      效果库
                    </li>
                    {(["march", "retreat", "reinforce", "transport"] as const).map(
                      (kind) => {
                        const preset = MAP_EFFECTS[kind];
                        return (
                          <LegendRow key={kind}>
                            <span
                              className="w-8 shrink-0 border-t-2"
                              style={{
                                borderColor: "#9b2c2c",
                                borderTopStyle: preset.dash ? "dashed" : "solid",
                              }}
                            />
                            {preset.label} · {preset.hint}
                          </LegendRow>
                        );
                      },
                    )}
                    {(["battle", "siege", "ambush", "camp", "pass"] as const).map(
                      (kind) => {
                        const preset = MAP_EFFECTS[kind];
                        return (
                          <LegendRow key={kind}>
                            <span className="w-8 shrink-0 text-center text-sm text-cinnabar">
                              {preset.glyph}
                            </span>
                            {preset.label} · {preset.hint}
                          </LegendRow>
                        );
                      },
                    )}
                    <LegendRow>
                      <span className="w-8 shrink-0 text-center text-sm text-cinnabar">
                        ‖
                      </span>
                      对峙 · 双线带 + 垂直刻度
                    </LegendRow>
                  </ul>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      ) : null}

      {ready && !bounds ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="max-w-xs rounded-sm border border-line/70 bg-surface/92 px-4 py-3 text-center shadow-sm">
            <p className="font-serif text-sm text-ink">本幕信息不足，先显示底图</p>
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">
              不要求二次点击；可切换其他幕，或到“待考”查看未定位原因。
            </p>
          </div>
        </div>
      ) : null}

      {tooltip ? (
        <div
          className="pointer-events-none absolute z-30 max-h-[min(20rem,55vh)] w-72 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-sm border border-line/80 bg-surface/97 p-3 text-left shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
        >
          <p className="text-[10px] uppercase tracking-[0.16em] text-cinnabar">
            {tooltip.kicker}
          </p>
          <p className="mt-1 font-serif text-sm leading-5 text-ink">
            {tooltip.title}
          </p>
          {tooltip.subtitle ? (
            <p className="mt-1 text-[11px] leading-5 text-ink-soft">
              {tooltip.subtitle}
            </p>
          ) : null}
          {tooltip.quote ? (
            <p className="mt-2 border-l-2 border-cinnabar/40 pl-2 text-[11px] leading-5 text-ink-soft">
              “{tooltip.quote}”
            </p>
          ) : null}
          <p className="mt-2 text-[10px] text-ink-faint">
            悬停高亮 · 点击查看证据与地图要素
          </p>
        </div>
      ) : null}

      {correctingPlaceId ? (
        <div className="pointer-events-none absolute inset-x-3 top-16 z-20 flex justify-center">
          <div
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-sm border border-cinnabar/40 bg-surface-soft/95 px-3 py-2 text-xs text-ink shadow-md"
            role="status"
          >
            <Crosshair
              className="h-4 w-4 shrink-0 animate-pulse text-cinnabar"
              aria-hidden
            />
            <span>
              定位修正：点击地图为「{correctingPlace?.name ?? "该地点"}」选点
            </span>
            {onCancelCorrection ? (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-7! px-2! py-0!"
                onClick={onCancelCorrection}
              >
                取消
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {basemapMissing.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-9 z-20 flex justify-center">
          <div
            className="pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-sm border border-[#9b2c2c]/30 bg-[#fffaf0] p-3 text-xs text-[#6b6152] shadow-sm"
            role="alert"
          >
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-cinnabar"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-[#9b2c2c]">底图数据尚未就绪</p>
              <p className="mt-1 leading-5 text-[#6b6152]">
                未能读取{" "}
                {basemapMissing.map((url) => url.replace("/basemap/", "")).join("、")}
                。舆图要素仍可查看；底图生成后会显示陆地、水系与国界。
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={retryBasemap}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              重试
            </Button>
          </div>
        </div>
      ) : null}

      {fatalError ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#f4ead5]/90 p-6 text-center">
          <div className="max-w-sm">
            <AlertTriangle
              className="mx-auto h-7 w-7 text-cinnabar"
              aria-hidden
            />
            <p className="mt-2 font-serif text-base text-[#241f18]">舆图未能展开</p>
            <p className="mt-1 text-xs leading-5 text-[#6b6152]">
              {fatalError}
            </p>
            <p className="mt-2 text-[11px] text-[#7a6f5c]">
              请确认浏览器支持 WebGL，或刷新页面后重试。文本与证据面板仍然可用。
            </p>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-1 left-2 z-10 hidden text-[10px] text-[#7a6f5c] sm:block">
        <Info className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />
        示意要素不构成史实定论
      </div>
    </div>
  );
}
