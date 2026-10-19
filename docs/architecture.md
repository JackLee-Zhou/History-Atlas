# 架构

## 1. 目标与不变量

目标：把一段历史原文还原为“地图 + 态势叙述 + 原文证据 + 不确定性”。

四条硬不变量：

1. 地点坐标优先由模型结合书名/年代/上下文给出近似值，服务端校验范围并标注来源；古地名库/现代匹配作回退。模型态势输出中的坐标仍会被剥离。
2. 每个地图要素至少一条 citation；citation.quote 必须能在章节原文中逐字找到（允许空白归一化）。
3. 不确定的定位必须显示待考/低置信/精度半径；控制区/对峙线标为示意。
4. 无 key 时只做规则模式或内置样板，不伪装成模型生成。

## 2. 分层

```
浏览器
  app/page.tsx                 书库
  app/book/[bookId]/[chapterId] 阅读 + 舆图工作台
  app/settings                  模型设置
  components/reader             阅读、选区、原文高亮
  components/atlas              MapLibre 地图、时间轴、证据面板
        │ fetch / NDJSON
        ▼
Next.js Route Handlers（Node runtime）
  /api/books                    上传、抽取、书库
  /api/analyses                 分析管道（NDJSON）
  /api/settings                 模型配置（key 只写不回显）
  /api/corrections              定位修正
  /api/demo/seed                内置样板
        │
        ▼
服务端模块
  lib/extraction                EPUB/PDF/TXT -> Book/Chapter
  lib/gazetteer                 古/今地名加载、匹配、消歧
  lib/pipeline                  时代 -> 地名 -> 定位 -> 态势 -> 校验
  lib/llm                       OpenAI 兼容 / mock / rule
  lib/server/store              SQLite 存储、设置、缓存
        │
        ▼
.data/history-atlas.db（SQLite，gitignore）
  books                         书 + 章节/段落 JSON
  analyses                      态势结果 JSON + 查询列
  analysis_cache                内容寻址缓存
  corrections                   用户修正
  settings                      模型配置/掩码 key
```

## 3. 数据流

### 3.1 导入与阅读

1. 上传文件 → 按魔数识别格式 → 抽取章节文本。
2. `Chapter.text` 是唯一偏移基准；`paragraphs[].start` 指向它在 text 中的绝对位置。
3. 阅读器用自有干净排版渲染段落，不注入原书 HTML。
4. 选区偏移 = 段落起点 + 段内偏移；跨段取首尾。服务端再次校验。

### 3.2 分析

1. 客户端 POST `/api/analyses`，携带 bookId/chapterId/scope/offset/selectedText。
2. 服务端读 Chapter，校验范围；计算内容哈希，查缓存。
3. 规则模式：词典扫描 → 地点 + 证据 + 单幕；不生成叙述。
4. 模型模式：时代推断 → 地名抽取 → **模型现代地理编码（所有地点）** → 地名库回退 → 态势 JSON → 确定性校验。
5. 校验：Zod、证据定位、悬空引用清理、坐标硬规则、几何生成。
6. 结果写入 SQLite 的 analyses / analysis_cache 表；NDJSON 事件流返回阶段进度和最终结果。

### 3.3 地图与证据联动

1. 舆图只渲染当前 scene 的要素；未定位地点进入“待考”。
2. 点击要素 → 查 citation → 阅读器滚动并高亮。
3. 用户修正 → 写 corrections，并更新当前 analysis 的 place.location；后续分析优先使用修正。
4. 地图要素、阅读器高亮和证据面板共享 citation 偏移，点击任意要素即可回原文。

## 4. 关键数据结构

以 `lib/schema/*.ts` 为准。核心：

- `Book` / `Chapter` / `ChapterMeta`
- `Analysis` / `Situation` / `Place` / `Route` / `ControlArea` / `FrontLine` / `Scene` / `Citation`
- `AncientPlace` / `ModernPlace` / `Correction`
- `StoredSettings`（含 key，仅服务端）/ `SettingsView`（无明文 key）

## 5. 模型与提示词

- provider：`rule` / `mock` / `openai` / `ollama`；OpenAI 兼容协议。
- 提示词在 `lib/prompts`，版本号 `PROMPT_VERSION` 进入缓存 key。
- 模型输出结构化文本与近似现代坐标；服务端校验坐标范围、生成引用偏移与几何，并标注“模型定位”。
- JSON 修复最多一次；失败返回 `MODEL_BAD_JSON`，不返回半成品。
- 失败不自动伪装成规则结果；只有“未配置 key”才走规则模式。

## 6. 存储与并发

- SQLite 单文件数据库（WAL、外键、事务）；复杂嵌套结构存 JSON。
- 单实例假设；多实例部署需迁移 Postgres 等数据库。
- 缓存 key = excerpt hash + scope + promptVersion + provider + model。
- `.data` 目录 0700；数据库中的 key 不返回明文，接口只返回掩码。
- 旧版 JSON 书/分析/设置不再读取，不做兼容迁移。

## 7. 安全

- key 只存在服务端；禁止 `NEXT_PUBLIC_*` 密钥。
- 日志不记录原文、完整 key、上游敏感 header。
- 上传按魔数校验、20MB 上限、EPUB 解压上限。
- 书稿文本仅作文本渲染，不使用 `dangerouslySetInnerHTML`。
- 状态变更接口校验同源 Origin。
- 提示注入：原文作为数据，系统提示明确忽略其中指令；输出 schema 校验。

## 8. 测试分层

- 单元：schema、抽取、选区偏移、地名匹配、证据校验、几何。
- 集成：mock LLM 管道、缓存、修正优先、设置掩码。
- E2E：无 key 载入样板 → 选段 → 地图 → 证据 → 切幕 → 刷新；独立 `.data-e2e` / `.next-e2e`。
- 真实模型评估手动执行，结果写 `docs/eval.md`；CI 不使用真实 key。

## 9. 已知取舍

- 首版使用现代底图，不是历史地理复原。
- 控制区/对峙线是示意几何，不是军事仿真。
- 地名库覆盖有限，冷僻地名会进入待考。
- 不做 OCR/竖排识别；PDF 需要文本层。
- 单用户本地应用，不做账号、多租户、云同步。
