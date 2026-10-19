import { z } from "zod";

import { confidenceSchema, idSchema, periodSchema } from "./common";

/** How a power relates to a province in an approximate overview. */
export const overviewStatusSchema = z.enum([
  "core",
  "contested",
  "nominal",
  "presence",
]);

export const overviewPowerKindSchema = z.enum([
  "dynasty",
  "regime",
  "army",
  "coalition",
  "foreign",
  "other",
]);

export const overviewPowerSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  kind: overviewPowerKindSchema.default("other"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const overviewControllerSchema = z.object({
  powerId: z.string().min(1).max(80),
  status: overviewStatusSchema,
  confidence: confidenceSchema.default(0.5),
  note: z.string().max(240).optional(),
});

export const overviewRegionSchema = z.object({
  province: z.string().min(1).max(40),
  controllers: z.array(overviewControllerSchema).min(1).max(4),
});

/** What the model is allowed to return. Colors/meta are assigned server-side. */
export const overviewDraftSchema = z.object({
  asOf: periodSchema,
  powers: z
    .array(
      z.object({
        id: z.string().min(1).max(80).optional(),
        name: z.string().min(1).max(80),
        kind: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(16),
  regions: z.array(overviewRegionSchema).min(1).max(40),
  summary: z.string().min(1).max(2_000),
  caveats: z.array(z.string().max(300)).max(8).default([]),
});

export const overviewSchema = z.object({
  asOf: periodSchema,
  powers: z.array(overviewPowerSchema).min(1).max(16),
  regions: z.array(overviewRegionSchema).min(1).max(40),
  summary: z.string().min(1).max(2_000),
  caveats: z.array(z.string().max(300)).max(8).default([]),
  meta: z.object({
    source: z.literal("model"),
    model: z.string().min(1),
    generatedAt: z.string().datetime(),
  }),
});

export const overviewInputSchema = z.object({
  bookId: idSchema,
  chapterId: idSchema,
  refresh: z.boolean().optional(),
});

export type OverviewStatus = z.infer<typeof overviewStatusSchema>;
export type OverviewPowerKind = z.infer<typeof overviewPowerKindSchema>;
export type OverviewPower = z.infer<typeof overviewPowerSchema>;
export type OverviewController = z.infer<typeof overviewControllerSchema>;
export type OverviewRegion = z.infer<typeof overviewRegionSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type OverviewInput = z.infer<typeof overviewInputSchema>;
