export const APP_NAME = "史地舆图";
export const APP_SUBTITLE = "历史文本态势还原";
export const APP_DESCRIPTION =
  "把史书里的行军、对峙与城池，还原成一张可追溯的态势图。";

export const MAX_SELECTION_CHARS = 6000;
export const CHAPTER_WINDOW_CHARS = 2200;
export const MAX_CHAPTER_WINDOWS = 12;
export const CHAPTER_OVERLAP_PARAGRAPHS = 1;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_EPUB_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_CACHE_BYTES = 500 * 1024 * 1024;
export const PROMPT_VERSION = "p17";
export const LLM_TIMEOUT_MS = 90_000;
export const LLM_MAX_RETRIES = 2;
export const LLM_TEMPERATURE = 0.2;

export const FACTION_COLORS = [
  "#9b2c2c",
  "#2c5282",
  "#2f6b4f",
  "#a16207",
  "#6b46c1",
  "#0f766e",
] as const;

/** Distinct palette for the AI overview; deliberately more saturated than
 * the scene atlas palette so neighbouring provinces stay distinguishable. */
export const OVERVIEW_POWER_COLORS = [
  "#b33a3a",
  "#2b5f9e",
  "#2f7d54",
  "#c08a2e",
  "#7b4fa0",
  "#1f7f85",
  "#c04f75",
  "#5c677d",
] as const;

export const DEFAULT_FACTION_COLOR = "#5b5346";

export const PLACE_CATEGORY_LABELS = {
  city: "城池",
  pass: "关隘",
  ferry: "渡口",
  battlefield: "战场",
  camp: "营地",
  region: "区域",
  other: "地点",
} as const;

export const ROUTE_KIND_LABELS = {
  advance: "进军",
  retreat: "退却",
  reinforce: "增援",
  transport: "转运",
  other: "移动",
} as const;

export const PRECISION_LABELS = {
  site: "遗址级",
  county: "县级",
  city: "市级",
} as const;

export const PRECISION_RADIUS_KM = {
  site: 3,
  county: 12,
  city: 30,
} as const;

export const PROVIDER_LABELS = {
  rule: "规则模式",
  mock: "演示模式",
  openai: "OpenAI 兼容",
  ollama: "Ollama 本地",
} as const;

export const PROVIDER_PRESETS = {
  deepseek: {
    label: "DeepSeek",
    provider: "openai" as const,
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  openai: {
    label: "OpenAI",
    provider: "openai" as const,
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  ollama: {
    label: "Ollama 本地",
    provider: "ollama" as const,
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:7b",
  },
  custom: {
    label: "自定义 OpenAI 兼容",
    provider: "openai" as const,
    baseUrl: "",
    model: "",
  },
} as const;

export type ProviderPresetKey = keyof typeof PROVIDER_PRESETS;

export const DEMO_BOOK_ID = "demo-three-kingdoms";
export const DEMO_CHAPTER_IDS = ["chi-bi-49", "chi-bi-50"] as const;
export const DEMO_ANALYSIS_ID = "demo-chibi-analysis";

export const BASEMAP_BOUNDS: [number, number, number, number] = [
  70, 15, 140, 55,
];
export const MAP_INITIAL_CENTER: [number, number] = [110, 32];
export const MAP_INITIAL_ZOOM = 3.4;
export const MAP_MAX_ZOOM = 9;
