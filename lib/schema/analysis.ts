import { z } from "zod";
import {
  citationSchema,
  confidenceSchema,
  idSchema,
  lineStringGeometrySchema,
  periodSchema,
  placeCategorySchema,
  polygonGeometrySchema,
  precisionSchema,
  usageSchema,
  warningSchema,
} from "./common";

export const analysisScopeSchema = z.enum([
  "selection",
  "page",
  "paragraph",
  "chapter",
]);

export const factionSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  note: z.string().max(500).optional(),
});

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: precisionSchema,
  confidence: confidenceSchema,
  radiusKm: z.number().min(0).max(500),
  source: z.enum(["gazetteer", "modern", "model", "user", "demo"]),
});

export const unresolvedCandidateSchema = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  gazetteerId: z.string().optional(),
});

export const unresolvedSchema = z.object({
  reason: z.string().min(1),
  candidates: z.array(unresolvedCandidateSchema).default([]),
});

export const placeSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  category: placeCategorySchema,
  factionId: z.string().optional(),
  role: z.string().max(200).optional(),
  modernName: z.string().max(200).optional(),
  locationNote: z.string().max(500).optional(),
  location: locationSchema.optional(),
  unresolved: unresolvedSchema.optional(),
  evidence: z.array(idSchema).min(1),
});

export const routeSchema = z.object({
  id: idSchema,
  factionId: z.string().optional(),
  fromPlaceId: idSchema,
  toPlaceId: idSchema,
  kind: z.enum(["advance", "retreat", "reinforce", "transport", "other"]),
  label: z.string().max(200).optional(),
  evidence: z.array(idSchema).min(1),
});

export const controlAreaSchema = z.object({
  id: idSchema,
  factionId: idSchema,
  name: z.string().min(1),
  geometry: polygonGeometrySchema,
  schematic: z.literal(true),
  evidence: z.array(idSchema).min(1),
});

export const frontLineSchema = z.object({
  id: idSchema,
  name: z.string().max(200).optional(),
  factionIds: z.array(idSchema).min(2),
  geometry: lineStringGeometrySchema,
  schematic: z.literal(true),
  evidence: z.array(idSchema).min(1),
});

export const sceneSchema = z.object({
  id: idSchema,
  index: z.number().int().min(0),
  title: z.string().min(1),
  timeLabel: z.string().optional(),
  summary: z.string().min(1),
  placeIds: z.array(idSchema).default([]),
  routeIds: z.array(idSchema).default([]),
  areaIds: z.array(idSchema).default([]),
  frontLineIds: z.array(idSchema).default([]),
  camera: z
    .object({
      center: z.tuple([z.number(), z.number()]),
      zoom: z.number().min(1).max(12),
    })
    .optional(),
});

export const summarySchema = z.object({
  overview: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  uncertainty: z.array(z.string()).default([]),
});

export const situationSchema = z.object({
  title: z.string().min(1),
  timeLabel: z.string().optional(),
  period: periodSchema.optional(),
  summary: summarySchema,
  factions: z.array(factionSchema).default([]),
  places: z.array(placeSchema).default([]),
  routes: z.array(routeSchema).default([]),
  controlAreas: z.array(controlAreaSchema).default([]),
  frontLines: z.array(frontLineSchema).default([]),
  scenes: z.array(sceneSchema).default([]),
  citations: z.array(citationSchema).default([]),
});

export const analysisMetaSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  cacheHit: z.boolean().default(false),
  usage: usageSchema.optional(),
  warnings: z.array(warningSchema).default([]),
});

export const analysisSchema = z.object({
  id: idSchema,
  bookId: idSchema,
  chapterId: idSchema,
  scope: analysisScopeSchema,
  excerpt: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    textHash: z.string().min(1),
  }),
  meta: analysisMetaSchema,
  situation: situationSchema,
});

export const analysisInputSchema = z.object({
  bookId: idSchema,
  chapterId: idSchema,
  scope: analysisScopeSchema,
  start: z.number().int().min(0).optional(),
  end: z.number().int().min(1).optional(),
  selectedText: z.string().max(20_000).optional(),
});

export const analysisStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: z.enum([
      "cache",
      "period",
      "places",
      "resolve",
      "situation",
      "validate",
      "persist",
      "done",
    ]),
    message: z.string(),
    progress: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("partial"),
    analysisId: z.string().optional(),
    sceneCount: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal("result"),
    analysis: analysisSchema,
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean().default(false),
  }),
]);

export type AnalysisScope = z.infer<typeof analysisScopeSchema>;
export type Faction = z.infer<typeof factionSchema>;
export type PlaceLocation = z.infer<typeof locationSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Route = z.infer<typeof routeSchema>;
export type ControlArea = z.infer<typeof controlAreaSchema>;
export type FrontLine = z.infer<typeof frontLineSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type Situation = z.infer<typeof situationSchema>;
export type AnalysisMeta = z.infer<typeof analysisMetaSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export type AnalysisStreamEvent = z.infer<typeof analysisStreamEventSchema>;
