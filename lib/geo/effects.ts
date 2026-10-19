import type { Place, Route } from "@/lib/schema";

/**
 * Visual language for the atlas. Keep the presets here so routes, markers,
 * labels and the legend use the same vocabulary instead of ad-hoc dashes.
 */
export type MapEffectKind =
  | "march"
  | "retreat"
  | "reinforce"
  | "transport"
  | "standoff"
  | "battle"
  | "siege"
  | "ambush"
  | "camp"
  | "pass"
  | "city"
  | "control";

export interface MapEffectPreset {
  kind: MapEffectKind;
  label: string;
  glyph: string;
  /** Dash pattern for MapLibre line layers, when this is a route effect. */
  dash?: [number, number];
  lineWidth: number;
  pulse: boolean;
  hint: string;
}

export const MAP_EFFECTS: Record<MapEffectKind, MapEffectPreset> = {
  march: {
    kind: "march",
    label: "行军",
    glyph: "→",
    lineWidth: 2.6,
    pulse: false,
    hint: "实线 + 箭头，箭头指向行军终点",
  },
  retreat: {
    kind: "retreat",
    label: "退却",
    glyph: "⇠",
    dash: [2, 2],
    lineWidth: 2.4,
    pulse: false,
    hint: "短虚线，箭头朝向撤离方向",
  },
  reinforce: {
    kind: "reinforce",
    label: "增援",
    glyph: "⇢",
    dash: [7, 2],
    lineWidth: 2.2,
    pulse: false,
    hint: "长虚线，表示兵力增援/调动",
  },
  transport: {
    kind: "transport",
    label: "粮道",
    glyph: "⋯",
    dash: [1, 3],
    lineWidth: 2,
    pulse: false,
    hint: "点线，表示粮草/辎重运输",
  },
  standoff: {
    kind: "standoff",
    label: "对峙",
    glyph: "‖",
    lineWidth: 2.4,
    pulse: true,
    hint: "双线对峙带 + 垂直刻度，标出接触面",
  },
  battle: {
    kind: "battle",
    label: "战斗",
    glyph: "⚔",
    lineWidth: 2.2,
    pulse: true,
    hint: "脉冲圆环 + 交叉刀剑，标出交战地点",
  },
  siege: {
    kind: "siege",
    label: "围城",
    glyph: "◎",
    lineWidth: 2.2,
    pulse: true,
    hint: "脉冲围环，标出被围/围攻的城池",
  },
  ambush: {
    kind: "ambush",
    label: "伏击",
    glyph: "⌄",
    lineWidth: 2.2,
    pulse: true,
    hint: "折线伏击标记，提示设伏方向",
  },
  camp: {
    kind: "camp",
    label: "驻军",
    glyph: "⚑",
    lineWidth: 2,
    pulse: false,
    hint: "旗标，表示军队驻扎/集结",
  },
  pass: {
    kind: "pass",
    label: "关隘",
    glyph: "关",
    lineWidth: 1.8,
    pulse: false,
    hint: "关隘标记，表示通道/山口",
  },
  city: {
    kind: "city",
    label: "城池",
    glyph: "●",
    lineWidth: 1.8,
    pulse: false,
    hint: "城池/普通据点",
  },
  control: {
    kind: "control",
    label: "势力范围",
    glyph: "▨",
    lineWidth: 1.6,
    pulse: false,
    hint: "半透明色块 + 斜纹，表示活动范围（示意图）",
  },
};

const ROUTE_EFFECT: Record<Route["kind"], MapEffectKind> = {
  advance: "march",
  retreat: "retreat",
  reinforce: "reinforce",
  transport: "transport",
  other: "march",
};

export function routeEffect(kind: Route["kind"]): MapEffectPreset {
  return MAP_EFFECTS[ROUTE_EFFECT[kind] ?? "march"];
}

export function placeEffect(place: Place): MapEffectPreset {
  const clue = `${place.name}${place.role ?? ""}`;
  if (/伏|袭/.test(clue)) return MAP_EFFECTS.ambush;
  if (/围|攻|守|困/.test(clue)) return MAP_EFFECTS.siege;
  if (place.category === "battlefield" || /战|破|败|击/.test(clue)) {
    return MAP_EFFECTS.battle;
  }
  if (place.category === "camp") return MAP_EFFECTS.camp;
  if (place.category === "pass") return MAP_EFFECTS.pass;
  if (place.category === "region") return MAP_EFFECTS.control;
  return MAP_EFFECTS.city;
}
