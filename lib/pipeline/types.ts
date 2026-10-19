import type {
  Analysis,
  AnalysisInput,
  AnalysisScope,
  AnalysisStreamEvent,
  Chapter,
  Correction,
  Period,
  Place,
  PlaceCategory,
  PlaceLocation,
  StoredSettings,
  Warning,
} from "@/lib/schema";
import type { GazetteerData, MentionInput } from "@/lib/gazetteer";
import type { LlmClient, LlmConfig } from "@/lib/llm";

export type StageName =
  | "cache"
  | "period"
  | "places"
  | "resolve"
  | "situation"
  | "validate"
  | "persist"
  | "done";

export type EmitStage = (
  stage: StageName,
  message: string,
  progress?: number,
) => void;

export interface PipelineDeps {
  getChapter(bookId: string, chapterId: string): Promise<Chapter | null>;
  listCorrections(): Promise<Correction[]>;
  getCachedAnalysis(key: string): Promise<Analysis | null>;
  setCachedAnalysis(key: string, analysis: Analysis): Promise<void>;
  saveAnalysis(analysis: Analysis): Promise<void>;
  getEffectiveSettings(): Promise<StoredSettings>;
  loadGazetteer(): Promise<GazetteerData>;
  createLlmClient(config: LlmConfig): LlmClient;
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  emit?: (event: AnalysisStreamEvent) => void;
  deps?: Partial<PipelineDeps>;
  /** Test seam: override the provider client without touching settings. */
  clientFactory?: (config: LlmConfig) => LlmClient;
}

export interface ProviderPlan {
  mode: "rule" | "model";
  /** Provider recorded in meta/cache key. Fallback to rule is honest here. */
  provider: "rule" | "mock" | "openai" | "ollama";
  model: string;
  settings: StoredSettings;
  client?: LlmClient;
  /** Set when an OpenAI provider had no key and silently fell back to rule. */
  fallbackFrom?: "openai";
}

export interface AnalyzeSegment {
  chapter: Chapter;
  scope: AnalysisScope;
  start: number;
  end: number;
  text: string;
  /** Human label used in stream messages, never in the analysis itself. */
  label: string;
  titleHint: string;
}

export interface ModelPlaceDraft {
  name: string;
  quote?: string;
  context?: string;
  modernHint?: string;
  modernName?: string;
  modernAdmin?: string;
  locationReason?: string;
  locationConfidence?: number;
  category?: MentionInput["category"];
}

export interface ModelGeocodeDraft {
  name: string;
  modernName?: string;
  lat?: number;
  lng?: number;
  precision?: "site" | "county" | "city";
  confidence?: number;
  reason?: string;
}

export interface ModelFactionDraft {
  id?: string;
  name: string;
  color?: string;
  note?: string;
}

export interface ModelPlaceRoleDraft {
  placeId?: string;
  name?: string;
  factionId?: string;
  role?: string;
  evidence?: unknown;
}

export interface ModelRouteDraft {
  id?: string;
  factionId?: string;
  fromPlaceId?: string;
  toPlaceId?: string;
  kind?: string;
  label?: string;
  evidence?: unknown;
}

export interface ModelControlAreaDraft {
  id?: string;
  factionId?: string;
  name?: string;
  placeIds?: string[];
  evidence?: unknown;
}

export interface ModelFrontLineDraft {
  id?: string;
  name?: string;
  factionIds?: string[];
  placeIdA?: string;
  placeIdB?: string;
  betweenPlaceIds?: string[];
  placeIds?: string[];
  evidence?: unknown;
}

export interface ModelSceneDraft {
  id?: string;
  title?: string;
  timeLabel?: string;
  summary?: string;
  placeIds?: string[];
  routeIds?: string[];
  areaIds?: string[];
  frontLineIds?: string[];
}

export interface ModelSummaryDraft {
  overview?: string;
  keyPoints?: string[];
  uncertainty?: string[];
}

export interface ModelSituationDraft {
  title?: string;
  timeLabel?: string;
  summary?: ModelSummaryDraft;
  factions?: ModelFactionDraft[];
  places?: ModelPlaceRoleDraft[];
  routes?: ModelRouteDraft[];
  controlAreas?: ModelControlAreaDraft[];
  frontLines?: ModelFrontLineDraft[];
  scenes?: ModelSceneDraft[];
  evidence?: Array<{ quote?: string; refs?: string[] }>;
}

export interface PlaceSeed {
  id: string;
  name: string;
  category: PlaceCategory;
  modernName?: string;
  locationNote?: string;
  location?: PlaceLocation;
  unresolved?: Place["unresolved"];
  evidence: string[];
  role?: string;
  factionId?: string;
}

export interface UsageAccumulator {
  input: number;
  output: number;
}

export interface WarningSink {
  add(warning: Warning): void;
}

export interface SegmentResult {
  situation: Analysis["situation"];
}

export interface AnalyzeContext {
  request: AnalysisInput;
  options: AnalyzeOptions;
  deps: PipelineDeps;
  plan: ProviderPlan;
  warnings: Warning[];
  usage: UsageAccumulator;
  emit: (event: AnalysisStreamEvent) => void;
  signal?: AbortSignal;
  gazetteer: GazetteerData;
  corrections: Correction[];
  period?: Period;
  /** True when period came from a real/mock model call. */
  periodFromModel: boolean;
}
