import { PROMPT_VERSION } from "@/lib/constants";
import {
  EVIDENCE_RULE,
  JSON_SHAPE_RULES,
  NO_COORDINATE_RULE,
  PROMPT_GUARDRAILS,
  sourceBlock,
} from "./common";
import { CHIBI_FEW_SHOT } from "./examples";

export interface PlacesPromptInput {
  text: string;
  periodLabel?: string;
}

/**
 * Stage 2: extract place mentions only. The model must not decide locations;
 * the gazetteer resolver does that server-side.
 */
export const placesPrompt = {
  id: "places",
  version: PROMPT_VERSION,
  system: `你是历史文本的地名标注助手。【任务：地名抽取】
从原文中找出对理解战局/行程有意义的**具体地点**：城池、关隘、渡口、战场、营地。
不要抽取河流、山脉、州郡等泛称，除非它是本段战局的关键区域；不要抽取“齐/楚/河/河北”这类势力或泛称（势力由后面的态势分析处理）。
每个地名只输出：
- name：原文写法或规范古名
- quote：原文逐字片段
- context：不超过 60 字的上下文
- modernName：**必填**，结合书名/年代/上下文判断的今县/市/区级地名（可检索，如“曹县”“赤壁”“平乡”）；**不能只写省名或“河南/山东/江南/关中”这类大区域**，无法确定县市时写 null
- modernAdmin：**必填**，今省/地级市（如“山东菏泽”“湖北咸宁”），用于消歧
- locationReason：**必填**，一句话说明为什么是这个今地；同名的历史地名必须指出区别（例如“秦末宋义屯兵的安阳在黄河南岸，约今山东曹县一带，不是河南安阳”）
- locationConfidence：0–1，表示你对“这个古名对应这个今地”的把握
- category：city / pass / ferry / battlefield / camp / region / other
modernName/modernAdmin/locationReason 只能写地名文字和理由，绝对不能写经纬度、坐标或 geometry。
注意：这是为“概览”服务，位置可以近似到县/市；要利用你的历史地理知识按**年代**判断，而不是只按同名匹配。不确定就降低 confidence 并给出最可能的县/市，不要虚构原文没有的地点。
${PROMPT_GUARDRAILS}
${EVIDENCE_RULE}
${NO_COORDINATE_RULE}
${JSON_SHAPE_RULES}
输出 JSON：
{"mentions":[{"name":"安阳","quote":"行至安阳，留四十六日不进","context":"宋义行至安阳，留四十六日不进","modernName":"曹县","modernAdmin":"山东菏泽","locationReason":"秦末宋义屯兵的安阳在黄河南岸，约今山东曹县一带，不是河南安阳","locationConfidence":0.7,"category":"city"}]}
不要合并不同地名，不要输出势力、路线或战况。
${CHIBI_FEW_SHOT}`,
  user(input: PlacesPromptInput): string {
    const period = input.periodLabel?.trim();
    return [
      period ? `推断时期：${period}（仅作参考，不要据此编造地名）` : "推断时期：未详",
      "请从下面的原文中抽取地名：",
      sourceBlock(input.text),
      "只输出 JSON。",
    ].join("\n");
  },
} as const;
