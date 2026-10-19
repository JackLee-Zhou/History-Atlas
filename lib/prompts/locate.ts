import { PROMPT_VERSION } from "@/lib/constants";
import {
  JSON_SHAPE_RULES,
  NO_COORDINATE_RULE,
  PROMPT_GUARDRAILS,
  sourceBlock,
} from "./common";

export interface LocatePromptPlace {
  name: string;
  context?: string;
  quote?: string;
}

export interface LocatePromptInput {
  text: string;
  periodLabel?: string;
  places: LocatePromptPlace[];
}

/**
 * Stage 2b: fill in modern locations for places the gazetteer could not resolve.
 *
 * This exists for the "approximate overview" use case. The model may suggest a
 * modern county/city name ("今山东菏泽定陶区"), but it still must not output
 * coordinates; the server geocodes the suggestion against the modern gazetteer.
 */
export const locatePrompt = {
  id: "locate",
  version: PROMPT_VERSION,
  system: `你是历史地名今地补全助手。【任务：今地补全】
给你一段原文和一组历史地名，请为每个地名补全最可能的**现代地名**，用于粗略地图概览。
- 只写现代地名文字（县/市/区/镇或“约今××一带”），不要只写省名，不要写经纬度、坐标、geometry 或任何位置字段。
- 必须结合原文年代和上下文判断，不要只按古今同名匹配；给出 reason 说明判断依据。
- 即使不确定，也要给出一个最接近的现代地名，并用 confidence（0–1）表示把握；完全无法判断时写 null。
- 只能补全给定列表中的地名，不要新增地点，不要改写原文证据。
${PROMPT_GUARDRAILS}
${NO_COORDINATE_RULE}
${JSON_SHAPE_RULES}
输出 JSON：
{"locations":[{"name":"定陶","modernHint":"今山东菏泽市定陶区","reason":"秦末定陶在济水与菏水之间，今菏泽定陶区","confidence":0.8}]}`,
  user(input: LocatePromptInput): string {
    const places = input.places
      .map((place, index) => {
        const context = place.context?.trim() || place.quote?.trim() || "";
        return `${index + 1}. ${place.name}${context ? `（上下文：${context.slice(0, 80)}）` : ""}`;
      })
      .join("\n");
    return [
      input.periodLabel ? `推断时期：${input.periodLabel}` : "推断时期：未详",
      "待补全的地名：",
      places || "（无）",
      "原文：",
      sourceBlock(input.text),
      "只输出 JSON。",
    ].join("\n");
  },
} as const;
