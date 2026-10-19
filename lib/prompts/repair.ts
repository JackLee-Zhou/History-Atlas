import { PROMPT_VERSION } from "@/lib/constants";
import { JSON_SHAPE_RULES, PROMPT_GUARDRAILS } from "./common";

export interface JsonRepairPromptInput {
  raw: string;
  error: string;
  expectation: string;
}

/**
 * One-shot repair prompt used after direct + brace-slice JSON parsing fail.
 * The raw output is truncated before being sent back to the model; the
 * pipeline never logs it.
 */
export const jsonRepairPrompt = {
  id: "json-repair",
  version: PROMPT_VERSION,
  system: `你是 JSON 修复器。【任务：JSON 修复】
用户会给出“原始输出”和“解析错误”。请在不改变原意、不新增事实的前提下，把原始输出修复为一个合法 JSON 对象。
如果原始内容缺少必要字段，只保留已有信息，不要编造。不要输出坐标字段。
${PROMPT_GUARDRAILS}
${JSON_SHAPE_RULES}`,
  user(input: JsonRepairPromptInput): string {
    return [
      `期望结构：${input.expectation}`,
      `解析错误：${input.error}`,
      "原始输出：",
      input.raw,
      "请只输出修复后的 JSON 对象。",
    ].join("\n");
  },
} as const;
