import { z } from "zod";

export const idSchema = z.string().min(1).max(200);

export const positionSchema = z.tuple([z.number(), z.number()]);

export const lineStringGeometrySchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2),
});

export const polygonGeometrySchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(positionSchema).min(3)).min(1),
});

export const yearSchema = z.number().int().min(-3000).max(2100);

export const confidenceSchema = z.number().min(0).max(1);

export const precisionSchema = z.enum(["site", "county", "city"]);

export const placeCategorySchema = z.enum([
  "city",
  "pass",
  "ferry",
  "battlefield",
  "camp",
  "region",
  "other",
]);

export const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]).default("warning"),
  refs: z.array(idSchema).default([]),
});

export const citationSchema = z
  .object({
    id: idSchema,
    quote: z.string().min(1).max(1000),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
  })
  .refine((citation) => citation.end > citation.start, {
    message: "citation end must be greater than start",
    path: ["end"],
  });

export const periodSchema = z.object({
  label: z.string().min(1),
  startYear: yearSchema.optional(),
  endYear: yearSchema.optional(),
  confidence: confidenceSchema.default(0.5),
});

export const usageSchema = z.object({
  input: z.number().int().min(0),
  output: z.number().int().min(0),
});

export type Position = z.infer<typeof positionSchema>;
export type LineStringGeometry = z.infer<typeof lineStringGeometrySchema>;
export type PolygonGeometry = z.infer<typeof polygonGeometrySchema>;
export type Citation = z.infer<typeof citationSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Warning = z.infer<typeof warningSchema>;
export type Precision = z.infer<typeof precisionSchema>;
export type PlaceCategory = z.infer<typeof placeCategorySchema>;
export type Usage = z.infer<typeof usageSchema>;
