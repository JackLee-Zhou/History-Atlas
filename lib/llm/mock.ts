import { sliceBracedObject } from "./json";
import type {
  LlmClient,
  LlmCompleteArgs,
  LlmStreamArgs,
  LlmTextResult,
} from "./types";

/**
 * Deterministic offline provider used by tests and the demo. It reads the
 * system prompt for the pipeline task marker and returns fixed JSON shaped
 * like the real prompts. It never performs network I/O.
 */
export class MockLlmClient implements LlmClient {
  readonly name = "mock";
  readonly model: string;

  constructor(model = "mock") {
    this.model = model;
  }

  async complete(args: LlmCompleteArgs): Promise<LlmTextResult> {
    const system = args.system;

    if (system.includes("【任务：JSON 修复】")) {
      const braced = sliceBracedObject(args.user);
      if (braced) {
        try {
          JSON.parse(braced);
          return { raw: braced };
        } catch {
          // fall through to an empty object
        }
      }
      return { raw: "{}" };
    }

    if (system.includes("【任务：时期判定】")) {
      const period = guessMockPeriod(args.user);
      return { raw: JSON.stringify(period) };
    }

    if (system.includes("【任务：地名抽取】")) {
      const mentions = extractMockMentions(args.user);
      return { raw: JSON.stringify({ mentions }) };
    }

    if (system.includes("【任务：态势分析】")) {
      return { raw: JSON.stringify(buildMockSituation(args.user)) };
    }

    if (system.includes("【任务：史地问答】")) {
      return {
        raw: JSON.stringify({
          answer: "演示模式未接入真实模型，无法进行史地问答。",
          citations: [],
          focus: { placeIds: [], routeIds: [] },
        }),
      };
    }

    return {
      raw: "演示模式未配置真实模型服务，这是固定的离线回复。",
    };
  }

  async stream(args: LlmStreamArgs): Promise<{ usage?: undefined }> {
    const text = "演示模式未配置真实模型服务，这是固定的离线回复。";
    for (const chunk of [text.slice(0, 8), text.slice(8, 20), text.slice(20)]) {
      if (chunk) args.onDelta(chunk);
    }
    return {};
  }

  async testConnection(_signal?: AbortSignal): Promise<{ latencyMs: number }> {
    void _signal;
    return { latencyMs: 0 };
  }
}

const MOCK_PLACES: Array<{
  name: string;
  category: string;
  modernHint: string;
}> = [
  { name: "江陵", category: "city", modernHint: "今湖北荆州" },
  { name: "赤壁", category: "battlefield", modernHint: "今湖北赤壁市" },
  { name: "乌林", category: "battlefield", modernHint: "今湖北洪湖市" },
  { name: "夏口", category: "city", modernHint: "今湖北武汉" },
  { name: "樊口", category: "ferry", modernHint: "今湖北鄂州" },
  { name: "华容", category: "city", modernHint: "今湖北监利" },
  { name: "当阳", category: "city", modernHint: "今湖北当阳" },
  { name: "长坂", category: "battlefield", modernHint: "今湖北当阳" },
];

function sourceTextFromPrompt(user: string): string {
  const startMarker = "<<<原文开始>>>";
  const endMarker = "<<<原文结束>>>";
  const start = user.indexOf(startMarker);
  if (start < 0) return user;
  const end = user.indexOf(endMarker, start + startMarker.length);
  return end > start
    ? user.slice(start + startMarker.length, end)
    : user.slice(start + startMarker.length);
}

function contextQuote(text: string, index: number, length: number): string {
  const left = Math.max(0, index - 10);
  const right = Math.min(text.length, index + length + 14);
  return text
    .slice(left, right)
    .replace(/^[，。；、：\s]+/, "")
    .replace(/[，。；：\s]+$/, "")
    .trim();
}

function extractMockMentions(
  user: string,
): Array<Record<string, string>> {
  const text = sourceTextFromPrompt(user);
  const mentions: Array<Record<string, string>> = [];
  for (const place of MOCK_PLACES) {
    const index = text.indexOf(place.name);
    if (index < 0) continue;
    mentions.push({
      name: place.name,
      quote: contextQuote(text, index, place.name.length),
      context: contextQuote(text, index, place.name.length),
      modernHint: place.modernHint,
      category: place.category,
    });
  }
  return mentions;
}

function guessMockPeriod(user: string): Record<string, string | number> {
  const text = sourceTextFromPrompt(user);
  if (text.includes("建安") || text.includes("赤壁")) {
    return {
      label: "东汉末年",
      startYear: 184,
      endYear: 220,
      confidence: 0.5,
    };
  }
  return { label: "未详", confidence: 0.2 };
}

interface MockPlaceLine {
  id: string;
  name: string;
  quote?: string;
}

function parseMockPlaceLines(user: string): MockPlaceLine[] {
  const lines = user.split("\n");
  const places: MockPlaceLine[] = [];
  for (const line of lines) {
    const match = /^\s*-\s*(p\d+)\s+([^\s（(]+)(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    // The evidence marker is the last field on the line. Original quotes can
    // contain corner brackets, so use the last closing bracket.
    const marker = "证据原文：";
    const rest = match[3] ?? "";
    const markerIndex = rest.indexOf(marker);
    let quote: string | undefined;
    if (markerIndex >= 0) {
      let raw = rest.slice(markerIndex + marker.length).trim();
      if (raw.startsWith("「")) raw = raw.slice(1);
      const close = raw.lastIndexOf("」");
      if (close >= 0) raw = raw.slice(0, close);
      quote = raw.trim() || undefined;
    }
    places.push({
      id: match[1],
      name: match[2],
      quote,
    });
  }
  return places;
}

function buildMockSituation(user: string): Record<string, unknown> {
  const places = parseMockPlaceLines(user);
  if (places.length === 0) {
    return {
      title: "演示态势",
      summary: {
        overview: "演示模式未在文本中识别到可定位地名。",
        keyPoints: [],
        uncertainty: ["演示模式（mock）不调用真实模型，结果仅供界面联调。"],
      },
      factions: [],
      places: [],
      routes: [],
      controlAreas: [],
      frontLines: [],
      scenes: [],
    };
  }

  const factions = [
    { id: "f1", name: "曹操军", color: "#9b2c2c" },
    ...(places.length > 1
      ? [{ id: "f2", name: "孙刘联军", color: "#2c5282" }]
      : []),
  ];

  const placeEntries = places.map((place, index) => ({
    placeId: place.id,
    factionId: index === 0 ? "f1" : index === 1 ? "f2" : undefined,
    role: index === 0 ? "出发点" : "战场",
  }));

  const routes =
    places.length > 1
      ? [
          {
            fromPlaceId: places[0]!.id,
            toPlaceId: places[1]!.id,
            kind: "advance",
            label: "演示路线",
            factionId: "f1",
            evidence: places[0]!.quote ? [places[0]!.quote] : [],
          },
        ]
      : [];

  const frontLines =
    places.length > 1
      ? [
          {
            factionIds: ["f1", "f2"],
            betweenPlaceIds: [places[0]!.id, places[1]!.id],
            evidence: places[0]!.quote ? [places[0]!.quote] : [],
          },
        ]
      : [];

  return {
    title: "演示态势",
    timeLabel: "东汉末年",
    summary: {
      overview: `演示模式（mock）根据原文中的 ${places.length} 个地名生成占位态势，未进行真实语义推演。`,
      keyPoints: places.map((place) => place.name),
      uncertainty: [
        "演示模式（mock）不调用真实模型；势力、路线与对峙关系仅为占位示例。",
      ],
    },
    factions,
    places: placeEntries,
    routes,
    controlAreas: [],
    frontLines,
    scenes: [
      {
        id: "s1",
        title: "演示场景",
        summary: "按原文地名顺序展示的演示场景。",
        placeIds: places.map((place) => place.id),
        routeIds: routes.length > 0 ? ["r1"] : [],
        areaIds: [],
        frontLineIds: frontLines.length > 0 ? ["fl1"] : [],
      },
    ],
  };
}

export function createMockClient(model = "mock"): LlmClient {
  return new MockLlmClient(model);
}
