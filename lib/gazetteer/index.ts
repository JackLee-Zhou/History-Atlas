import "server-only";

export {
  clearGazetteerCache,
  GAZETTEER_FILES,
  gazetteerDirectory,
  loadGazetteer,
} from "./loader";
export {
  aliasVariants,
  extractModernHint,
  labelsCompatible,
  normalizeName,
  scanKey,
  toSimplified,
  toTraditional,
} from "./normalize";
export {
  categoryOrDefault,
  placePeriodMatches,
  resolveMentions,
} from "./resolve";
export { scanGazetteer } from "./scan";
export type {
  GazetteerData,
  GazetteerLoadOptions,
  MentionInput,
  ResolveMentionsInput,
  ResolvedCandidate,
  ResolvedPlace,
  ResolvedSource,
  ScanCandidate,
  ScanGazetteerOptions,
} from "./types";
