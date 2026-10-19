import type {
  AncientPlace,
  Correction,
  Dynasty,
  ModernPlace,
  Period,
  PlaceCategory,
  PlaceLocation,
  Precision,
  Warning,
} from "@/lib/schema";

export interface GazetteerData {
  ancient: AncientPlace[];
  modern: ModernPlace[];
  dynasties: Dynasty[];
}

export interface MentionInput {
  /** Name as reported by the model or the dictionary scanner. */
  name: string;
  /** Verbatim text excerpt that mentions the place (used for evidence). */
  quote?: string;
  /** Surrounding sentence; only used to recover a "今…" modern hint. */
  context?: string;
  /** Model-provided modern hint such as "今湖北赤壁市西北". */
  modernHint?: string;
  /** Era-aware modern county/city suggested by the model. */
  modernName?: string;
  /** Province/prefecture for disambiguating the modern name. */
  modernAdmin?: string;
  /** One-sentence reason for the historical→modern identification. */
  locationReason?: string;
  /** Model confidence for the modern identification (0–1). */
  locationConfidence?: number;
  /** Model-first modern geocode (approximate WGS84) for this mention. */
  modelLocation?: {
    lat: number;
    lng: number;
    precision?: Precision;
    confidence?: number;
    modernName?: string;
    reason?: string;
  };
  category?: PlaceCategory;
}

export interface ResolveMentionsInput {
  mentions: MentionInput[];
  /** Period inferred for the excerpt. Missing means "do not filter". */
  period?: Period | { label: string; startYear?: number; endYear?: number };
  corrections?: Correction[];
  bookId?: string;
  gazetteer?: GazetteerData;
  /** Extra text used to recover "今…" hints when a mention has none. */
  contextText?: string;
}

export interface ResolvedCandidate {
  label: string;
  lat?: number;
  lng?: number;
  gazetteerId?: string;
}

export type ResolvedSource =
  | "gazetteer"
  | "modern"
  | "model"
  | "user"
  | "unresolved";

export interface ResolvedPlace {
  /** Canonical ancient name when matched, otherwise the mention name. */
  name: string;
  category: PlaceCategory;
  location?: PlaceLocation;
  unresolved?: { reason: string; candidates: ResolvedCandidate[] };
  confidence: number;
  source: ResolvedSource;
  precision?: Precision;
  radiusKm?: number;
  matchedBy: "exact" | "alias" | "correction" | "modern" | "model" | "none";
  ancientPlaceId?: string;
  modernPlaceId?: string;
  modernName?: string;
  /** Human-readable basis for a model/modern lookup, shown in the UI. */
  locationNote?: string;
  mention: MentionInput;
  warnings: Warning[];
}

export interface ScanCandidate {
  /** Canonical name from the gazetteer. */
  name: string;
  /** Exact slice of the input text (original script, untouched). */
  quote: string;
  /** Offset relative to the scanned text. */
  offset: number;
  end: number;
  matchedText: string;
  category: PlaceCategory;
  ancientPlaceId?: string;
  modernPlaceId?: string;
  modernName?: string;
  source: "gazetteer" | "modern";
  matchedBy: "exact" | "alias";
}

export interface ScanGazetteerOptions {
  gazetteer?: GazetteerData;
  /** Match modern place names too. Off by default to avoid false positives. */
  includeModern?: boolean;
  /** Maximum number of candidates returned. */
  limit?: number;
  /** Directories are only used by tests; production reads assets/gazetteer. */
  directory?: string;
}

export interface GazetteerLoadOptions {
  directory?: string;
  force?: boolean;
}
