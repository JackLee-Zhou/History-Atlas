# 契约（Wave 0 冻结）

本文件描述跨模块契约。**类型与校验以 `lib/schema/*.ts` 为准**；本文件用于快速对齐。

## 1. 数据流

```
上传文件 → lib/extraction 抽取 → Book + Chapter（SQLite books 表）
阅读器划选 → POST /api/analyses → 缓存/管道 → Analysis（SQLite analyses 表）
→ Atlas 渲染 + 证据面板
点击要素 → 阅读器高亮 citation
修正定位 → POST /api/corrections → 更新分析要素
```

## 2. 核心类型

- `Book` / `ChapterMeta` / `Chapter`：`lib/schema/book.ts`
- `Analysis` / `Situation` / `Place` / `Route` / `Scene` / `Citation`：`lib/schema/analysis.ts`
- `AncientPlace` / `ModernPlace` / `Correction`：`lib/schema/gazetteer.ts`
- `StoredSettings` / `SettingsView`：`lib/schema/settings.ts`

关键不变量：

1. `Chapter.text` 是唯一偏移基准；所有 citation offset 相对它。
2. `Place.location` 由服务端解析器写入；模型现代地理编码的近似坐标经范围校验后进入结果，态势 JSON 中的坐标仍被剥离。
3. `Place.evidence` / `Route.evidence` / `ControlArea.evidence` / `FrontLine.evidence` 非空。
4. `ControlArea.schematic` 与 `FrontLine.schematic` 必须为 `true`。
5. `Scene` 只引用已存在的地点/路线/区域/对峙线 ID。

## 3. API（全部 Node runtime）

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| `GET /api/books` | — | `{ books: Book[], demoSeeded: boolean }` |
| `POST /api/books` | multipart `file` 或 JSON `{title,text}` | `{ book: Book }` |
| `GET /api/books/:id` | — | `{ book: Book }` |
| `DELETE /api/books/:id` | — | `{ ok: true }` |
| `GET /api/books/:id/chapters/:cid` | — | `{ chapter: Chapter }` |
| `POST /api/analyses` | `AnalysisInput` | NDJSON 事件流 |
| `GET /api/analyses/:id` | — | `{ analysis: Analysis }` |
| `GET /api/corrections` | — | `{ corrections: Correction[] }` |
| `POST /api/corrections` | `Correction` 去掉 id/createdAt | `{ correction: Correction }` |
| `DELETE /api/corrections/:id` | — | `{ ok: true }` |
| `GET /api/settings` | — | `SettingsView` |
| `PUT /api/settings` | `SettingsUpdate` | `SettingsView` |
| `POST /api/settings/test` | `SettingsTestInput` | `SettingsTestResult` |
| `DELETE /api/settings/key` | — | `SettingsView` |
| `GET /api/status` | — | 状态摘要（SQL 计数） |
| `GET /api/health` | — | `{ ok: true }`（容器健康检查） |
| `POST /api/demo/seed` | — | `{ book, analysis }` |

NDJSON 事件：`AnalysisStreamEvent`（见 schema）。每行一个 JSON，客户端用 `fetch` + `ReadableStream` 解析。

错误响应（非流式）：`{ error: { code, message } }`，HTTP 4xx/5xx。流式错误用事件 `{type:"error"}`。

## 4. 存储布局

```
.data/history-atlas.db
  books / analyses / analysis_cache / corrections / settings
```

- SQLite：WAL、外键、事务；JSON 载荷 + 查询列/索引。
- 单实例假设；多实例部署需换 Postgres 等。
- `.data/` 永不提交；settings 表含用户 key，接口只返回掩码。

## 5. 提示词与模型

- provider：`rule`（默认无 key）、`mock`（测试）、`openai`（兼容 DeepSeek/OpenAI/Ollama）、`ollama`。
- `lib/llm/index.ts` 与 `lib/llm/types.ts` 定义统一接口：

```ts
interface LlmClient {
  readonly name: string;
  readonly model: string;
  completeJson<T>(args: { system: string; user: string; temperature?: number; signal?: AbortSignal }): Promise<{ raw: string; usage?: Usage }>;
  streamText(args: { system: string; user: string; signal?: AbortSignal; onDelta: (text: string) => void }): Promise<{ usage?: Usage }>;
}
```

- 解析 JSON 时先尝试直接 `JSON.parse`，再尝试首尾大括号截取；失败触发一次修复提示。
- 所有模型输出必须经 Zod 校验与确定性后处理；模型负责现代地理编码的近似坐标，服务端负责范围校验、回退与几何。
- 提示词版本 `PROMPT_VERSION` 进入缓存 key。

## 6. 地图契约

- GeoJSON 坐标统一 WGS84；底图离线，来自 `public/basemap/*.geojson`。
- 地图组件输入 `Analysis` + 当前 scene index；输出回调 `onSelectFeature` / `onCorrectPlace`。
- 使用 DOM marker 渲染中文标签，不用 MapLibre symbol/glyphs。
- 路线箭头用 `map.addImage` + symbol layer；控制区用 fill/line；对峙线用 dashed line。
- 图层 ID 固定：
  - `control-fill`, `control-outline`
  - `frontline`
  - `route-line`, `route-arrow`
  - 地点用 DOM marker，不用 MapLibre 层。

## 7. 测试契约

- 单元测试放 `tests/unit`，不得依赖网络/真实 key。
- 集成测试用 `mock` provider；断言：模型坐标经校验、证据无效即丢弃、地名库回退、未知地点待考、缓存命中、修正优先。
- E2E 使用 `mock`/`rule`，不得调用外部 API。
- 真实模型评估手动执行，结果写 `docs/eval.md`；不把真实 key 写进报告。
