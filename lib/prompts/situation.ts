import { PROMPT_VERSION } from "@/lib/constants";
import {
  EVIDENCE_RULE,
  JSON_SHAPE_RULES,
  NO_COORDINATE_RULE,
  PROMPT_GUARDRAILS,
  sourceBlock,
} from "./common";
import { CHIBI_FEW_SHOT } from "./examples";

export interface SituationPromptPlace {
  id: string;
  name: string;
  category: string;
  modernName?: string;
  located: boolean;
  evidenceQuote?: string;
}

export interface SituationPromptInput {
  text: string;
  periodLabel?: string;
  places: SituationPromptPlace[];
}

/**
 * Stage 4: turn resolved places + source text into a schematic situation.
 * The model may only reference the provided placeIds; all coordinates are
 * computed later by the server. Evidence quotes are verbatim text snippets.
 */
export const situationPrompt = {
  id: "situation",
  version: PROMPT_VERSION,
  system: `你是历史军事态势分析助手。【任务：态势分析】
输入是一段原文和一份“可用地点”清单。地点已经由服务端地名库定位，你必须：
- 只能使用清单中给出的 placeId，绝不能发明新地点、坐标或 geometry。
- 用 factions 表示文中出现的势力；places 只补充 placeId 对应的 factionId 与 role。
- 先判断语义：**移动**（追/攻/退/援/运输）才用 routes，fromPlaceId/toPlaceId 必须是清单里的 placeId，并且是同一叙事段已经出现的地点；不要把后文才出现的地点当作起点或终点。
- **驻守/对峙**（收兵、修建营垒、据险自守、对垒、相持、僵持、布阵、按兵不动、不敢轻举妄动）不是行军，不要为它生成 routes。用 frontLines 表示：给 name（如“称海对峙”）、factionIds（至少 2 个）和 betweenPlaceIds（驻守点与敌方最近点），不要输出几何；必要时再配 controlAreas 表示营垒/控制区域。
- 用 controlAreas 表示势力控制范围：只给 factionId、name 和 placeIds（至少 2 个已定位地点），服务端会据此生成示意范围，不要输出几何。
- 对峙/驻守地点要在对应 scene 里引用，不能只写进 frontLines 而不挂到场景。
- 用 scenes 组织叙事顺序；点击场景时只展示其引用的要素。可以给 route/controlArea/frontLine 临时 id，场景引用这些 id。
- summary 总结态势，uncertainty 写出兵力、地点、时间等方面的不确定处。
${PROMPT_GUARDRAILS}
${EVIDENCE_RULE}
${NO_COORDINATE_RULE}
${JSON_SHAPE_RULES}
输出 JSON：
{"title":"...","timeLabel":"...","summary":{"overview":"...","keyPoints":["..."],"uncertainty":["..."]},
"factions":[{"id":"f1","name":"曹操军","color":"#9b2c2c"}],
"places":[{"placeId":"p1","factionId":"f1","role":"出发地"}],
"routes":[{"id":"r1","fromPlaceId":"p1","toPlaceId":"p2","factionId":"f1","kind":"advance","label":"顺江东下","evidence":["曹操自江陵东下"]}],
"controlAreas":[{"id":"a1","factionId":"f1","name":"曹操军控制区","placeIds":["p1","p2"],"evidence":["曹操自江陵东下"]}],
"frontLines":[{"id":"fl1","name":"赤壁对峙","factionIds":["f1","f2"],"betweenPlaceIds":["p1","p2"],"evidence":["遇于赤壁"]}],
"scenes":[{"title":"战前推进","summary":"...","placeIds":["p1","p2"],"routeIds":["r1"],"areaIds":[],"frontLineIds":[]}]}
没有依据的要素直接省略，不要为了填满字段而编造。
evidence 可以写在每个要素上（evidence: ["原文逐字引文"]），也可以集中写在顶层 evidence:[{"quote":"原文逐字引文","refs":["p1","r1"]}]，refs 指向你输出的地点/路线/控制区/对峙线 id。
${CHIBI_FEW_SHOT}`,
  user(input: SituationPromptInput): string {
    const period = input.periodLabel?.trim() || "未详";
    const lines = input.places.map((place) => {
      const modern = place.modernName ? `（今${place.modernName}）` : "";
      const status = place.located ? "已定位" : "待考（未定位）";
      const quote = place.evidenceQuote
        ? `证据原文：「${place.evidenceQuote}」`
        : "证据原文：无";
      return `- ${place.id} ${place.name}${modern} · ${place.category} · ${status} · ${quote}`;
    });
    return [
      `推断时期：${period}`,
      "可用地点（只能引用这些 placeId）：",
      lines.length > 0 ? lines.join("\n") : "（无可用地点；不要发明地点）",
      "请分析下面的原文：",
      sourceBlock(input.text),
      "只输出 JSON。",
    ].join("\n");
  },
} as const;
