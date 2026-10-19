import { PROMPT_VERSION } from "@/lib/constants";
import {
  JSON_SHAPE_RULES,
  PROMPT_GUARDRAILS,
  sourceBlock,
} from "./common";

export interface GeocodePromptPlace {
  name: string;
  quote?: string;
  context?: string;
  category?: string;
}

export interface GeocodePromptInput {
  bookTitle?: string;
  chapterTitle?: string;
  periodLabel?: string;
  text: string;
  places: GeocodePromptPlace[];
}

/**
 * Stage 2c: model-first modern geocoding for *every* place mention.
 *
 * This is deliberately separate from the gazetteer resolver. Ancient-name
 * matching and 15k-entry modern gazetteers are useful shortcuts, but they
 * cannot disambiguate era-specific homonyms such as 瓜州/和林/永昌. The model
 * sees the book, chapter, period and surrounding text and returns an approximate
 * modern point; the server validates the coordinates and marks them as model
 * locations so the UI can be honest about precision.
 */
export const geocodePrompt = {
  id: "geocode",
  version: PROMPT_VERSION,
  system: `你是历史地理定位助手。【任务：现代地理定位】
给你一本历史书的书名、章节、年代、原文片段和一组地名。请为**每个**地名判断：在**这段文本、这个年代**里，它指今天的哪里，并给出近似的现代坐标。
要求：
- 必须结合年代和上下文消歧，不能因为“同名”就匹配到另一个地方。例如明初的瓜州应是今甘肃瓜州县，而不是江西同名村镇；和林应是今蒙古国哈拉和林，而不是四川小镇。
- 每个地名返回：name（必须来自给定列表）、modernName（今省/市/县/镇地址）、lat、lng（WGS84 十进制，近似到 0.01 度即可）、precision（site/county/city）、confidence（0–1）、reason（一句话说明为什么是这里，指出同名异地的区别）。
- 河流、山脉、草原、行省等大范围对象，给一个有代表性的点，precision 用 city，reason 说明是代表点。
- 绝对不要新增列表外的地名；不要返回 [0,0] 或明显不在中国/东亚的坐标。
- 不确定时给最可能的点并降低 confidence，不要猜测成另一个同名地点。
${PROMPT_GUARDRAILS}
${JSON_SHAPE_RULES}
输出 JSON：
{"locations":[{"name":"瓜州","modernName":"甘肃省酒泉市瓜州县","lat":40.52,"lng":95.78,"precision":"county","confidence":0.85,"reason":"明初瓜州指今甘肃瓜州县，不是江西同名地名"}]}`,
  user(input: GeocodePromptInput): string {
    const meta = [
      input.bookTitle ? `书名：${input.bookTitle}` : "",
      input.chapterTitle ? `章节：${input.chapterTitle}` : "",
      input.periodLabel ? `年代：${input.periodLabel}` : "年代：未详",
    ]
      .filter(Boolean)
      .join("\n");
    const places = input.places
      .map((place, index) => {
        const context = place.context?.trim() || place.quote?.trim() || "";
        return `${index + 1}. ${place.name}${place.category ? `（${place.category}）` : ""}${
          context ? `｜上下文：${context.slice(0, 100)}` : ""
        }`;
      })
      .join("\n");
    return [
      meta,
      "需要定位的地名：",
      places || "（无）",
      "原文片段：",
      sourceBlock(input.text.slice(0, 5000)),
      "只输出 JSON。",
    ].join("\n");
  },
} as const;
