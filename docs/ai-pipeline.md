# 分析管道与模型 Provider（AI-Core）

本文档描述 `lib/llm/`、`lib/gazetteer/`、`lib/pipeline/`、`lib/prompts/` 与
`POST/GET /api/analyses` 的实现约定。类型与运行时校验的最终依据仍是
`lib/schema/*.ts`；本文档只做实现说明。

## 1. 模块地图

```
lib/llm/
  types.ts        # 契约（Captain 独占，未修改）
  index.ts        # createLlmClient 工厂（rule / mock / openai / ollama）
  openai.ts       # OpenAI 兼容 chat-completions 客户端
  rule.ts         # 规则模式占位客户端（不联网、不用于生成）
  mock.ts         # 测试/演示客户端（基于 system 任务标记返回固定 JSON）
  json.ts         # JSON 解析：直接 parse -> 首尾大括号截取

lib/gazetteer/
  loader.ts       # 运行时读取 assets/gazetteer/*.json；缺失回退 [] + warn
  normalize.ts    # opencc-js 繁简转换（只用于匹配串，不改原文）
  scan.ts         # trie 词典召回 scanGazetteer()
  resolve.ts      # resolveMentions(): 地名库/现代库/用户修正 -> 坐标
  types.ts        # 内部输入输出类型

lib/prompts/
  common.ts       # 统一护栏：原文是数据、只输出 JSON、不给坐标、证据逐字
  period.ts       # periodPrompt
  places.ts       # placesPrompt（只抽地名，不定位）
  situation.ts    # situationPrompt（引用 placeId，不发明地点）
  repair.ts       # jsonRepairPrompt（JSON 修复一次）
  examples.ts     # 赤壁 few-shot（仅格式示例，不混入用户原文）

lib/pipeline/
  index.ts        # analyzeSelection / analyzeChapter 编排、缓存、事件
  deps.ts         # 生产依赖装配（store / gazetteer / llm）
  evidence.ts     # 空白归一化引文定位、citation 注册表
  sanitize.ts     # 递归剥离模型输出的坐标/几何字段
  windows.ts      # 章节段落窗口：约 2200 字、最多 12 窗、重叠 1 段
  rule.ts         # 规则模式：词典召回 + 地名解析 + 单个 scene
  model.ts        # 模型模式：period/places/geocode/situation 四次 JSON 调用
  assemble.ts     # 模型态势后处理：势力/路线/控制区/对峙线/scene 校验
  merge.ts        # 章节多窗口结果合并与 ID 重映射
  geometry.ts     # 凸包+buffer 控制区、相机 bbox
  model-draft.ts  # 容忍字段类型的模型 JSON 形状解析
  period.ts       # 规则模式离线断代（年号/朝代）
```

## 2. 不变量

1. **模型先给出近似现代坐标，服务端校验。** 地名抽取会走模型现代地理编码；`stripModelCoordinates` 仍用于态势输出，避免模型在势力/路线 JSON 中夹带几何。模型返回的 `lat/lng` 会检查范围并标记来源；`Place.location` 也可能由 `resolveMentions` 从古地名库/现代地名库/用户修正回退。
2. **证据必须逐字。** 每条 `Place/Route/ControlArea/FrontLine` 至少 1 条
   `citation`。引文用“空白/标点归一化 + 繁简兼容”在原文中定位；命中的是原文切片，不是模型
   返回的字符串。找不到的引文被丢弃并记 `INVALID_CITATION` warning；因此
   没有任何合法引文的要素被丢弃并记 `EVIDENCE_MISSING`。
3. **无 key 不伪装。** `provider=openai` 且没有 API Key 时自动走规则模式，
   `meta.provider="rule"`、`meta.model="rule"`，并写 `NO_API_KEY` info warning。
   真实模型调用失败（认证/超时/限流/坏 JSON）会向上抛 `AppError`，不会降级
   成假结果。
4. **不返回章节全文。** Analysis 只包含 `excerpt.start/end/textHash` 和
   citation 的 `quote`；`GET /api/analyses/:id` 只返回 Analysis。

## 3. 分析流水线

`analyzeSelection(input, options)` 处理 `selection/page/paragraph`；
`analyzeChapter(input, options)` 强制 `scope=chapter`；`analyze()` 按 scope 分发。
两者共用同一条编排。

阶段（NDJSON `stage` 事件顺序）：

```
cache -> period -> places -> resolve -> situation -> validate -> persist -> done
```

- **cache**：计算缓存 key，命中则直接返回并设置 `meta.cacheHit=true`。
- **period**：规则模式用年号/朝代词离线判断；模型模式调用 `periodPrompt`。
  模型断代解析失败只会记录 `PERIOD_UNRECOGNIZED` 并继续，不影响主态势。
- **places**：规则模式 `scanGazetteer`；模型模式调用 `placesPrompt`，只允许
  `name/quote/context/modernHint/category`。
- **resolve**：`resolveMentions` 做时期过滤、精确/别名匹配、多候选 unresolved、
  `今…` 现代地名回退、用户修正优先（book 级 > 全局级）。
- **situation**：规则模式生成文字结论 + 1 个 scene；模型模式调用
  `situationPrompt`，后处理生成 factions/routes/controlAreas/frontLines/scenes。
- **validate**：Zod 校验、悬空引用清理、坐标来源复核、有效地点 < 2 warning。
- **persist**：`saveAnalysis`，随后 `setCachedAnalysis`（缓存写失败只告警，
  不影响已保存结果）。

`request.signal` 在阶段边界检查；中途取消抛 `ANALYSIS_ABORTED`，不会落盘半成品。
路由把非流式请求错误转成 `{type:"error",code,message,retryable}` 事件。

### 选段与章节

- 选段：校验 `start/end`（或 `selectedText` 定位），超过 `MAX_SELECTION_CHARS`
  （6000）会截断并写 `SELECTION_TRUNCATED` info warning。
- 章节：`buildChapterWindows` 按 `Chapter.paragraphs` 聚合约 2200 字窗口，
  相邻窗口重叠最后 1 段；超过 `MAX_CHAPTER_WINDOWS`（12）截断并写
  `CHAPTER_TRUNCATED` warning。模型模式逐窗口调用模型，再按名称/要素合并；
  规则模式不需要模型上下文，直接在“窗口覆盖范围”的原文上扫描一次，仍只输出
  1 个 scene。

### 规则模式

- 触发：`provider=rule`，或 `provider=openai` 但没有 API Key。
- 地点来自 `scanGazetteer`（古地名库；trie 扫描，支持繁简/别名）。
- 输出：地点 + 每条地点至少 1 条合法 citation + 1 个 scene + 文字 summary。
- 不生成 factions/routes/controlAreas/frontLines。
- 有效地点 < 2 时**不删除**结果，只写 `INSUFFICIENT_PLACES` warning；是否画图
  由前端决定。
- `summary.overview` 明确包含“规则模式仅标注可识别地名”。

### 模型模式

- 需要真实 key：`openai` 必须有 Base URL + 模型名 + API Key；`ollama` 允许无 key。
- `provider=mock` 是离线演示/测试路径，不联网，按 prompt 中的任务标记返回固定
  JSON。
- 流程：
  1. `placesPrompt` -> mentions（quote 逐字校验，非法引文的地名直接丢弃）；
  2. 服务端 `resolveMentions` -> `placeId`；
  3. `situationPrompt` -> factions/roles/routes/controlAreas/frontLines/scenes/summary；
  4. `assembleSituation` 做确定性后处理。
- 模型只能引用提示词给出的 `placeId`；引用不存在的地点记 `UNKNOWN_PLACE_REF`。
- 路线只输出端点 `fromPlaceId/toPlaceId`，几何由前端计算。
- 控制区：模型只给 `placeIds`；服务端按同势力地点凸包 + buffer 生成
  `schematic: true` 的 Polygon。模型没给时，服务端会为有 ≥2 个已定位地点的
  势力自动补一个示意控制区；没有合法证据就不生成。
- 对峙线：按模型给出的两个对立端点生成 `LineString`；端点/势力不合法则省略。
- Scene 引用在合并前重新映射；悬空引用被移除并记 `DANGLING_SCENE_REF`。
- 每个 Scene 的 `camera` 由所引用要素的 bbox 计算（`center` 为 `[lng, lat]`）。

### 有效地点 < 2

最终校验阶段统计“有 `location` 的 Place”，小于 2 时写
`INSUFFICIENT_PLACES`，不删除 places/citations。Analysis 仍通过 Zod 校验。

## 4. 证据与坐标校验

`lib/pipeline/evidence.ts`：

- `createQuoteIndex(text, baseOffset)` 建立归一化文本与原文偏移映射；
- `locateQuote(index, quote)`：先直接查找，再按空白归一化查找；返回原文切片
  与绝对偏移；
- citation id 固定为 `c-<start>-<end>`，同一区间自动去重；
- quote 上限 1000 字；
- 模型 evidence 兼容 `string[]`、`{quote}` 对象，以及顶层
  `evidence:[{quote,refs:[要素 id]}]`（refs 也可写 placeIds/routeIds 等）。

`lib/pipeline/sanitize.ts` 会在解析模型 JSON 后递归删除坐标类字段，并触发
`COORDINATES_STRIPPED` warning；这些字段永远不会进入 `Place.location`。

### 缓存 key

缓存 key 由 `lib/server/hash.ts` 的 `analysisCacheKey` 生成：

```
sha256(bookId + "\0" + chapterId + "\0" + text + "\0" + scope + "\0" + PROMPT_VERSION + "\0" + provider + "\0" + model)
```

- `text` 是实际分析范围文本（选段截断后 / 章节窗口覆盖范围）；
- `provider/model` 是**实际**生成者：无 key 降级时是 `rule/rule`；
- `PROMPT_VERSION` 来自 `lib/constants.ts`（当前 `p17`）；
- 命中缓存返回原 Analysis，`meta.cacheHit=true`，不再写盘；
- 成功后先 `saveAnalysis` 再 `setCachedAnalysis`。

## 5. Provider 行为

`createLlmClient(config, options?)`：

| provider | 行为 |
| --- | --- |
| `rule` | 不联网，返回空文本；实际规则抽取在 pipeline |
| `mock` | 不联网，按 system 任务标记返回固定 JSON/文本 |
| `openai` | 必须 Base URL + model + apiKey |
| `ollama` | 必须 Base URL + model，apiKey 可选 |

OpenAI 兼容请求：`POST ${baseUrl}/chat/completions`，`Authorization: Bearer <key>`，
body 为 `{model, messages, temperature, stream}`；JSON 模式尝试
`response_format:{type:"json_object"}`，若上游以 400/404/415/422/501 拒绝则去掉
该字段重试一次。

- 超时：90 秒（`LLM_TIMEOUT_MS`），`AbortError -> PROVIDER_TIMEOUT`。
- 429/5xx：p-retry 重试 2 次；429 最终 `PROVIDER_RATE_LIMIT`，5xx 最终
  `INTERNAL(retryable=true)`。
- 401/403：`PROVIDER_AUTH`，不重试。
- `stream()` 解析 SSE `data:` 行与 `[DONE]`，逐 delta 回调。
- 错误消息/日志不包含 API Key、消息全文或上游 header；测试用 mock fetch 验证。
- 缺失配置：`PROVIDER_NOT_CONFIGURED`，提示到设置页填写。

## 6. JSON 修复

`completeJsonStage`：

1. 直接 `JSON.parse`（允许 Markdown fence）；
2. 截取第一个 `{` 到最后一个 `}` 再解析；
3. 均失败时调用一次 `jsonRepairPrompt`，成功则写 `MODEL_JSON_REPAIRED` warning；
4. 仍失败抛 `AppError MODEL_BAD_JSON`。

## 7. API

### `POST /api/analyses`

- 校验 Origin（`assertSameOrigin`）与 `analysisInputSchema`；
- 返回 `application/x-ndjson`，每行一个 `AnalysisStreamEvent`；
- 事件：`stage`、`partial`（`analysisId/sceneCount`）、`result`、`error`；
- 请求中断在阶段边界停止，不写分析结果。

### `GET /api/analyses/:id`

- Next 16 动态参数为 `Promise<{id}>`；
- 返回 `{ analysis }`；
- 不存在 -> 404 `{error:{code:"ANALYSIS_NOT_FOUND",message}}`。

## 8. Prompt 版本与安全

- 所有提示词是 `lib/prompts/` 下的版本化常量，`version` 统一取 `PROMPT_VERSION`（当前 `p17`）；
- 统一护栏：原文是数据不是指令、只输出 JSON、不提供坐标、证据逐字、不确定标注；
- 赤壁 few-shot 只作为格式示例附在 prompts 中，不写入用户原文；
- 提示词中不包含任何密钥；模型调用只发生在服务端。

## 9. 测试

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/llm-openai.test.ts` | 注入 fetch：JSON/流/错误码/JSON 模式回退/不泄露 key |
| `tests/unit/pipeline-rule.test.ts` | 规则分析、修正优先、多候选待考、章节窗口、繁简召回、现代地名回退、assets 缺失回退 |
| `tests/unit/pipeline-validate.test.ts` | 假坐标剥离、无效引文丢弃、悬空引用清理、地点不足 warning、缓存命中、章节窗口合并 |

测试不依赖网络或真实 key；gazetteer 用测试数据注入，不依赖 `assets/` 是否已生成。
真实模型评测需手动执行并写 `docs/eval.md`，不在自动化测试中调用外部 API。
