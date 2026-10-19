import { z } from "zod";
import {
  confidenceSchema,
  idSchema,
  placeCategorySchema,
  precisionSchema,
  yearSchema,
} from "./common";

export const sourceRefSchema = z.object({
  label: z.string().min(1),
  url: z.string().url().optional(),
});

export const dynastySchema = z.object({
  label: z.string().min(1),
  startYear: yearSchema.optional(),
  endYear: yearSchema.optional(),
  aliases: z.array(z.string()).default([]),
});

export const ancientPlaceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  category: placeCategorySchema,
  periods: z
    .array(
      z.object({
        label: z.string().min(1),
        startYear: yearSchema.optional(),
        endYear: yearSchema.optional(),
      }),
    )
    .default([]),
  modernName: z.string().min(1),
  admin1: z.string().optional(),
  admin2: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: precisionSchema,
  confidence: confidenceSchema,
  source: sourceRefSchema,
  note: z.string().max(500).optional(),
});

export const modernPlaceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  admin1: z.string().optional(),
  admin2: z.string().optional(),
  population: z.number().int().min(0).optional(),
  geonameId: z.number().int().optional(),
});

export const correctionSchema = z.object({
  id: idSchema,
  ancientName: z.string().min(1),
  periodLabel: z.string().optional(),
  bookId: z.string().optional(),
  modernName: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: precisionSchema,
  createdAt: z.string().datetime(),
});

export type SourceRef = z.infer<typeof sourceRefSchema>;
export type Dynasty = z.infer<typeof dynastySchema>;
export type AncientPlace = z.infer<typeof ancientPlaceSchema>;
export type ModernPlace = z.infer<typeof modernPlaceSchema>;
export type Correction = z.infer<typeof correctionSchema>;
