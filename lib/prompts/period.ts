import { PROMPT_VERSION } from "@/lib/constants";
import {
  JSON_SHAPE_RULES,
  PROMPT_GUARDRAILS,
  sourceBlock,
} from "./common";

export interface PeriodPromptInput {
  text: string;
  hint?: string;
}

/**
 * Stage 1: infer the historical period of the excerpt. This is used only to
 * filter gazetteer entries; it never produces map features.
 */
export const periodPrompt = {
  id: "period",
  version: PROMPT_VERSION,
  system: `你是中国历史文本的断代助手。【任务：时期判定】
根据原文中的年号、朝代名、人物与事件，判断文本叙述所处时期。
${PROMPT_GUARDRAILS}
${JSON_SHAPE_RULES}
输出 JSON：
{"label":"朝代或年号时期，例如 东汉末年 / 建安十三年","startYear":184,"endYear":220,"confidence":0.6}
年份使用整数，公元前用负数。若无法判断，输出 {"label":"未详","confidence":0.1}，不要猜具体年份。`,
  user(input: PeriodPromptInput): string {
    const hint = input.hint?.trim();
    return [
      hint ? `已有线索：${hint}` : undefined,
      "请判断下面这段原文的时期：",
      sourceBlock(input.text),
      "只输出 JSON。",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  },
} as const;
