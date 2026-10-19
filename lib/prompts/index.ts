import { PROMPT_VERSION as PROMPT_VERSION_CONSTANT } from "@/lib/constants";
import { periodPrompt } from "./period";
import { placesPrompt } from "./places";
import { jsonRepairPrompt } from "./repair";
import { situationPrompt } from "./situation";
import { locatePrompt } from "./locate";
import { geocodePrompt } from "./geocode";

export const PROMPT_VERSION = PROMPT_VERSION_CONSTANT;

export {
  EVIDENCE_RULE,
  JSON_SHAPE_RULES,
  NO_COORDINATE_RULE,
  PROMPT_GUARDRAILS,
  SOURCE_TEXT_END,
  SOURCE_TEXT_START,
  sourceBlock,
} from "./common";
export { CHIBI_FEW_SHOT } from "./examples";
export { periodPrompt } from "./period";
export type { PeriodPromptInput } from "./period";
export { placesPrompt } from "./places";
export type { PlacesPromptInput } from "./places";
export { locatePrompt } from "./locate";
export type { LocatePromptInput, LocatePromptPlace } from "./locate";
export { geocodePrompt } from "./geocode";
export type { GeocodePromptInput, GeocodePromptPlace } from "./geocode";
export { jsonRepairPrompt } from "./repair";
export type { JsonRepairPromptInput } from "./repair";
export { situationPrompt } from "./situation";
export type { SituationPromptInput, SituationPromptPlace } from "./situation";

/** Every versioned prompt, useful for status/debug endpoints. */
export const PROMPT_REGISTRY = [
  periodPrompt,
  placesPrompt,
  locatePrompt,
  geocodePrompt,
  situationPrompt,
  jsonRepairPrompt,
] as const;
