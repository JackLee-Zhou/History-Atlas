import "server-only";

import { loadGazetteer } from "@/lib/gazetteer";
import { createLlmClient } from "@/lib/llm";
import {
  getCachedAnalysis,
  getChapter,
  getEffectiveSettings,
  listCorrections,
  saveAnalysis,
  setCachedAnalysis,
} from "@/lib/server/store";
import type { PipelineDeps } from "./types";

/** Default production wiring. Tests inject a partial dependency object. */
export const defaultPipelineDeps: PipelineDeps = {
  getChapter,
  listCorrections,
  getCachedAnalysis,
  setCachedAnalysis,
  saveAnalysis,
  getEffectiveSettings,
  loadGazetteer: () => loadGazetteer(),
  createLlmClient: (config) => createLlmClient(config),
};
