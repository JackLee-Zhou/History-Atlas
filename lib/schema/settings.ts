import { z } from "zod";

export const providerSchema = z.enum(["rule", "mock", "openai", "ollama"]);
export const geocoderSchema = z.enum(["none", "nominatim"]);

export const storedSettingsSchema = z.object({
  provider: providerSchema.default("rule"),
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  geocoder: geocoderSchema.default("none"),
  autoAnalyze: z.boolean().default(false),
});

export const settingsViewSchema = z.object({
  provider: providerSchema,
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  hasKey: z.boolean(),
  keyMasked: z.string().optional(),
  geocoder: geocoderSchema,
  autoAnalyze: z.boolean(),
});

export const settingsUpdateSchema = z.object({
  provider: providerSchema,
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
  geocoder: geocoderSchema.optional(),
  autoAnalyze: z.boolean().optional(),
});

export const settingsTestInputSchema = z.object({
  provider: providerSchema,
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  apiKey: z.string().max(500).optional(),
});

export const settingsTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int().min(0).optional(),
  model: z.string().optional(),
});

export type Provider = z.infer<typeof providerSchema>;
export type Geocoder = z.infer<typeof geocoderSchema>;
export type StoredSettings = z.infer<typeof storedSettingsSchema>;
export type SettingsView = z.infer<typeof settingsViewSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type SettingsTestInput = z.infer<typeof settingsTestInputSchema>;
export type SettingsTestResult = z.infer<typeof settingsTestResultSchema>;
