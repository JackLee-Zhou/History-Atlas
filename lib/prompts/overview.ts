import { PROMPT_VERSION } from "@/lib/constants";
import { JSON_SHAPE_RULES, PROMPT_GUARDRAILS } from "./common";

export interface OverviewPromptInput {
  bookTitle: string;
  chapterTitle: string;
  periodLabel?: string;
  periodRange?: string;
  context?: string;
  excerpt: string;
  provinceNames: string[];
}

const STATUS_RULES = `状态只能是以下四种之一：
- core：较稳定的控制/行政中心；
- contested：双方争夺、反复易手或控制很弱；
- nominal：名义归附、称臣或羁縻，不等于实际行政控制；
- presence：农民军、流寇、远征军等活动区域，不等于建立政权控制。
同一个省最多给两个主要状态，第二个用 contested 表示争夺。`;

export const overviewPrompt = {
  id: "overview",
  version: PROMPT_VERSION,
  system: `你是中国历史地理的推演助手。【任务：天下大势总览】
根据书名、章节、年代线索和节选，给出一个“省域级”的历史势力控制快照。

要求：
1. 只使用中国省级行政区名称，不能返回坐标、经纬度、GeoJSON 或自由多边形。
2. 只做近似推演，不追求精确历史边界；不确定就降低 confidence，不要编造确定性。
3. 必须区分 core / contested / nominal / presence，不能把流动作战势力直接当成建国领土。
4. 年代不明时，根据文本判断一个大致时期；不要输出“未详”作为唯一结果，除非完全看不出任何线索。
5. 一个省可以有多个势力，用 controllers 数组表达；不要把同一势力拆成多个势力。
6. 必须输出严格 JSON，不要 Markdown。
${STATUS_RULES}
${PROMPT_GUARDRAILS}
${JSON_SHAPE_RULES}

JSON 形状：
{
  "asOf": {"label":"元末至正二十年","startYear":1360,"endYear":1360,"confidence":0.55},
  "powers": [
    {"id":"yuan","name":"元廷","kind":"dynasty"},
    {"id":"zhu","name":"朱元璋","kind":"regime"}
  ],
  "regions": [
    {"province":"江苏省","controllers":[{"powerId":"zhu","status":"core","confidence":0.65,"note":"应天周边"}]},
    {"province":"河南省","controllers":[{"powerId":"yuan","status":"core","confidence":0.55},{"powerId":"zhu","status":"contested","confidence":0.35}]}
  ],
  "summary":"一句话概括当前天下态势。",
  "caveats":["这是 AI 历史推演，不是精确历史疆域。"]
}

只使用下面名单中的省级名称：
{{PROVINCES}}`,
  user(input: OverviewPromptInput): string {
    return [
      `书名：${input.bookTitle}`,
      `章节：${input.chapterTitle}`,
      input.periodLabel ? `已有年代线索：${input.periodLabel}` : undefined,
      input.periodRange ? `年代范围：${input.periodRange}` : undefined,
      input.context ? `已有分析上下文：\n${input.context}` : undefined,
      "节选：",
      input.excerpt,
      "请输出这个时间点的省域级天下大势 JSON。",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  },
} as const;

export function overviewSystemPrompt(provinceNames: string[]): string {
  return overviewPrompt.system.replace(
    "{{PROVINCES}}",
    provinceNames.join("、"),
  );
}
