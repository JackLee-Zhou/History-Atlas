import type { FeatureCollection, LineString, Point, Polygon } from "geojson";
import type { Route } from "@/lib/schema";
import type { MapEffectKind } from "./effects";

/** [longitude, latitude], the GeoJSON winding order used everywhere in this app. */
export type LngLatTuple = readonly [number, number];

/** Accepts a GeoJSON tuple or the `{lng, lat}` shape returned by MapLibre events. */
export type LngLatLike = LngLatTuple | { lng: number; lat: number };

/** [west, south, east, north] in WGS84 degrees. */
export type Bounds = readonly [number, number, number, number];

export type AtlasFeatureType = "place" | "route" | "area" | "frontline";

/** What the atlas can select. `area` maps to ControlArea, `frontline` to FrontLine. */
export interface AtlasSelection {
  type: AtlasFeatureType;
  id: string;
}

export interface RouteFeatureProperties {
  id: string;
  factionId?: string;
  color: string;
  label: string;
  kind: Route["kind"];
  effect: MapEffectKind;
  fromName: string;
  toName: string;
  factionName: string;
}

export interface ControlAreaFeatureProperties {
  id: string;
  name: string;
  factionId: string;
  color: string;
}

export interface FrontLineFeatureProperties {
  id: string;
  name?: string;
  color: string;
  factionIds: string[];
}

export interface FrontLineTickProperties {
  id: string;
}

export interface ArrowFeatureProperties {
  id: string;
  /** Clockwise degrees from north, fed directly to MapLibre `icon-rotate`. */
  angle: number;
  color: string;
}

export interface AccuracyFeatureProperties {
  id: string;
  name: string;
  color: string;
  confidence: number;
  precision: string;
  radiusKm: number;
}

export type RouteFeatureCollection = FeatureCollection<
  LineString,
  RouteFeatureProperties
>;
export type ControlAreaFeatureCollection = FeatureCollection<
  Polygon,
  ControlAreaFeatureProperties
>;
export type FrontLineFeatureCollection = FeatureCollection<
  LineString,
  FrontLineFeatureProperties
>;
export type FrontLineTickFeatureCollection = FeatureCollection<
  LineString,
  FrontLineTickProperties
>;
export type ArrowFeatureCollection = FeatureCollection<
  Point,
  ArrowFeatureProperties
>;
export type AccuracyFeatureCollection = FeatureCollection<
  Polygon,
  AccuracyFeatureProperties
>;
