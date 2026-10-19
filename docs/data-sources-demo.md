# 内置演示数据：来源、整理原则与证据校验

本文说明 `assets/gazetteer/ancient-places.json`、`assets/demo/books/three-kingdoms.json` 与 `assets/demo/analyses/chibi.json` 的数据来源、许可、整理原则，以及“原文证据必须可逐字复核”的校验方法。

## 1. 文件与角色

| 文件 | 内容 | 运行时用途 |
| --- | --- | --- |
| `assets/gazetteer/ancient-places.json` | 122 条古地名（`AncientPlace`） | 地名检索、古今地名匹配、分析地点定位 |
| `assets/demo/books/three-kingdoms.json` | 《三国演义》第 49、50 回（`{ book, chapters }`） | 阅读器 / 内置示例书 |
| `assets/demo/analyses/chibi.json` | 赤壁态势样板（`Analysis`，第 50 回） | 无 key 时的内置示范 |
| `lib/server/seed.ts` | 读取 + Zod 校验 + 幂等落库 | `POST /api/demo/seed` |
| `scripts/validate-assets.ts` | 离线校验全部上述资产 | `npm run validate:assets` |

## 2. 古地名整理原则

1. **只收可解释的条目**：每条必须有 `id`、`name`、`aliases`、`category`、`periods`、`modernName`、`admin1`/`admin2`、`lat`/`lng`、`precision`、`confidence`、`source`、`note`。
2. **以今地定坐标**：`lat`/`lng` 是今地（城市、县治、镇或遗址）的 WGS84 坐标，`modernName` 写今地名；不在古地名与今地之间假装一一对应。
3. **精度诚实**：
   - `site`：有较明确的遗址/故城/关隘点，约 3 km 半径；
   - `county`：到县/镇级，约 12 km；
   - `city`：只能到市域或郡治示意，约 30 km。
   `confidence` 按证据强度给：明确今治/遗址 0.8–0.9；县治近似 0.6–0.8；仅到市域或学界有争议 0.25–0.6。低置信不是错误，但必须被标出来。
4. **每条 `note` 必须解释定位依据或存疑**。例如“古江陵城与今荆州古城同址；今江陵县为 1994 年后新设，治郝穴镇，不是古江陵”。
5. **坐标窗口**：`lng 73–135, lat 3–54`（中国及周边）。校验脚本会拒绝越界坐标。
6. **唯一性**：`id` 全局唯一，`name` 也按唯一处理；同一城址的不同政区名（如荆州/江陵/南郡）用不同 `id` 并注明关系。
7. **不复制受限数据**：不抄《中国历史地图集》、CHGIS、其他商业或受限历史地图集的点位/边界；坐标只来自公开今地资料、公开百科与项目人工核对。

### 主要来源

| 来源 | 用法 | 许可 |
| --- | --- | --- |
| [中文维基百科](https://zh.wikipedia.org/) 的今地/乡镇条目 | 97 条带有 `source.url` 的今地参考坐标；条目 URL 保留在数据中 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| 今地地方志 / 公开地名资料 | 遗址、关隘、古渡口的近似点位；`source.label` 写明“今地地方志（…）” | 按公开资料使用，不复制受限地图集 |
| 《三国演义》原文 | 示例书正文与证据 quote | 公有领域（中文维基文库） |

> 项目另有 `assets/gazetteer/modern-places.json`（GeoNames，CC BY 4.0），供现代地名检索使用；本古地名库**没有**用它来反推古地名坐标。

### 未使用的受限数据集

- 谭其骧主编《中国历史地图集》及其数字化成果；
- CHGIS（复旦大学/哈佛大学中国历史地理信息系统）；
- 任何未获授权的商业历史地图、地方志扫描件或现代测绘数据。

本项目不复制上述数据集的坐标、边界或图层，只用公开今地资料做“今地近似定位”。

## 3. 示例书来源与公版说明

- 第 49 回：<https://zh.wikisource.org/wiki/三國演義/第049回>
- 第 50 回：<https://zh.wikisource.org/wiki/三國演義/第050回>
- 抓取日期：**2026-10-18**（Asia/Shanghai）。
- 作者罗贯中逝世已超过 100 年，《三国演义》属于公有领域；维基文库页面版权栏亦标注公有领域。
- 抽取只移除页面导航/版权栏/编辑链接，清理段首全角缩进与段末空白；**字句、标点、繁简均保持原样**。正文以段落 `\n\n` 拼接，`paragraphs[].start` 由脚本计算并与 `text` 严格对齐。

## 4. 赤壁样板的证据规则

`assets/demo/analyses/chibi.json` 是**人工整理**的内置样板，不是模型生成：`meta.provider = "demo"`，`meta.model = "curated"`，`meta.cacheHit = false`，`meta.promptVersion = "p1"`。

- `scope = "chapter"`，`chapterId = "chi-bi-50"`；`excerpt.start = 0`、`excerpt.end = Chapter.text.length`，`textHash` 为该回原文的 SHA-256。
- 每个 `Place` / `Route` / `ControlArea` / `FrontLine` 至少有 1 条 `evidence`，每条 `evidence` 引用同一 `situation.citations` 中的 citation ID；场景只引用已存在的要素。
- 地点坐标取自古地名库（`source = "demo"`）；分析不含模型生成的坐标。
- 控制区与对峙线 `schematic: true`，是手工凸包/连线近似，**不是**实际控制边界或阵线。地图上必须按“示意”呈现。

### citation 的生成与校验

1. 从 `Chapter.text` 中选取一段原文作为 `quote`；
2. 用脚本在 `text` 中查找该 quote 的实际位置，写入 `start`（含）与 `end`（不含）；
3. 校验时对 `text` 与 `quote` 都做**空白归一化**（`\s+` 折叠为单个空格，含全角空格），保留原文下标映射；
4. 逐条检查：
   - `quote` 非空；
   - 能在本章原文中找到；
   - `start < end`，且 `start/end` 正好覆盖该 quote（不是别的片段）；
   - `text.slice(start, end)` 归一化后与 `quote` 归一化后一致；
   - 每个要素的 `evidence` 都指向存在的 citation，不允许悬空引用。
5. 任一条失败：输出 citation ID / 原因，脚本以非零退出；**不会**通过放宽校验来“修复”。

当前样板：15 个地点、7 条路线、2 个控制区、1 条对峙线、3 个场景、23 条 citation；23 条 quote 全部通过上述校验。

### 为什么没有“江陵 → 乌林”“柴桑 → 赤壁”等路线

样板只收录第 50 回原文能支持方向的路线。第 50 回虽出现“江陵”，但只作为曹操询问退路的目的地（“那裏投南郡江陵去近？”），没有“从江陵出发”的叙述；“柴桑”未出现；“樊口”未出现。因此这些路线不硬编，改为：
- 曹操：赤壁 → 乌林 → 彝陵 → 华容道 → 南郡 → 许昌；
- 韩当：赤壁 → 曹军水寨；
- 关羽：华容道 → 夏口（放曹后回师）。

## 5. 已知限制

- 古地名坐标是**示意/近似**，不是测绘成果，不能作为考古定位或导航依据。
- 赤壁古战场、乌林、华容道、三江口、南屏山、葫芦谷等位置有学界争议，已在 `note` 与 `confidence` 中标出。
- `source.url` 只覆盖 97/122 条；其余为今地资料/人工核对，来源标签仍可追溯。
- 示例书为节选，不是《三国演义》全文；分析只基于第 50 回，不代表全书情节。
- 控制区/对峙线为 schematic，几何不应被当作真实边界。

## 6. 更新流程

1. 更新文本：重新从维基文库抓取对应回，按同样规则清理并重建 `chapters[].text` 与 `paragraphs[].start`；
2. 更新分析：先改 `quote`，再跑一次性脚本重新计算 `start/end`，不要手填 offset；
3. 更新古地名：补/改条目后，确认 `id`/`name` 唯一、坐标在 bbox 内、`note` 写明依据或存疑；
4. 运行：
   ```bash
   npm run validate:assets
   npx vitest run tests/unit/assets.test.ts
   npx tsc --noEmit
   ```
5. 若失败，修数据或引文；不得删除检查、跳过测试或放宽 Zod schema。
