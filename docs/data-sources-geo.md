# 地理数据来源（底图与现代地名）

本项目的离线底图和现代地名库都是**生成物**，不要手工修改。本文记录来源、许可、处理方式、字段和刷新命令。

- 底图生成脚本：`scripts/build-basemap.mjs`（`npm run data:basemap`）
- 现代地名生成脚本：`scripts/fetch-geonames.mjs`（`npm run data:geonames`）
- 数据校验：`npx vitest run tests/unit/geodata.test.ts`

> 数据校验只检查文件存在、JSON/GeoJSON 结构、要素/条目数量下限、坐标范围和字段基本约束；**未对每个坐标做人工核对**，坐标精度以原始数据源为准，不能作为测绘或边界依据。

## 1. 离线底图（Natural Earth 50m）

### 1.1 来源与许可

四个图层均来自 [Natural Earth](https://www.naturalearthdata.com/) 的 1:50m 数据（`nvkelso/natural-earth-vector` 仓库 `geojson/` 目录，`master` 分支）：

| 输出文件 | 源文件 | 说明 |
| --- | --- | --- |
| `public/basemap/countries.geojson` | `ne_50m_admin_0_countries.geojson` | 国家/地区面 |
| `public/basemap/provinces.geojson` | `ne_50m_admin_1_states_provinces.geojson` | 中国省级面（仅 `adm0_a3 = CHN`） |
| `public/basemap/rivers.geojson` | `ne_50m_rivers_lake_centerlines.geojson` | 河流与湖中线 |
| `public/basemap/lakes.geojson` | `ne_50m_lakes.geojson` | 湖泊面 |

- 许可：**Public domain**（Natural Earth 数据不受版权限制；见 <https://www.naturalearthdata.com/about/terms-of-use/>）。
- 署名建议：`Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.`
- 说明：Natural Earth 是概化制图数据，不是精确行政边界；本项目只把它当离线参考底图。

### 1.2 处理方式

1. 下载上述四个 GeoJSON（脚本内 3 次重试，失败非零退出）。
2. 使用 `@turf/turf` 的 `bboxClip` 裁剪到 `[70, 15, 140, 55]`（与 `lib/constants.ts` 的 `BASEMAP_BOUNDS` 一致）。
3. 只保留渲染需要的属性，属性名统一为小写（源数据存在 `NAME_ZH` / `name_zh` 大小写差异，脚本做了兼容读取）。
4. 坐标四舍五入到 **4 位小数**；丢弃裁剪后为空的几何和退化环。
5. 输出 minified GeoJSON；先写临时文件再 `rename`，避免半成品。
6. 生成 `public/basemap/metadata.json`，记录来源 URL、bbox、生成时间（UTC ISO）、许可、处理参数、每个文件的要素数和字节数。

刷新命令：

```bash
node scripts/build-basemap.mjs
# 或
npm run data:basemap
```

### 1.3 生成的字段

| 文件 | properties |
| --- | --- |
| `countries.geojson` | `name`, `name_zh`, `adm0_a3` |
| `provinces.geojson` | `name`, `name_zh`, `adm0_a3`, `iso_3166_2` |
| `rivers.geojson` | `name`, `name_zh`（源数据无该字段时省略）, `scalerank` |
| `lakes.geojson` | `name`, `name_zh`（源数据缺失时省略）, `scalerank` |

- 所有坐标均为 WGS84（EPSG:4326）。
- Natural Earth 50m 河流图层**没有中文名字段**，因此 `rivers.geojson` 实际只有 `name` 和 `scalerank`；渲染时请回退到 `name`。
- 源数据中个别湖泊没有名字，对应要素只保留几何和 `scalerank`。
- `name_zh` 为源数据自带中文名，未做翻译或人工校订。

### 1.4 当前生成物（约为 485 KiB）

| 文件 | 要素数 | 字节数 |
| --- | --- | --- |
| `countries.geojson` | 25 | 208,205 |
| `provinces.geojson` | 31 | 151,084 |
| `rivers.geojson` | 87 | 95,923 |
| `lakes.geojson` | 59 | 41,151 |
| 合计（不含 metadata） | 202 | 496,363 |

`metadata.json` 会记录更精确的生成时间和文件信息；以上数字以当前仓库生成物为准，重新生成后可能随上游数据变化。

## 2. 现代地名库（GeoNames）

### 2.1 来源与许可

| 数据 | URL | 许可 |
| --- | --- | --- |
| 中国地名 | <https://download.geonames.org/export/dump/CN.zip>（`CN.txt`） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 一级行政区名 | <https://download.geonames.org/export/dump/admin1CodesASCII.txt> | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

- 署名：**GeoNames**，<https://www.geonames.org/>，数据按 CC BY 4.0 使用。
- 输出：`assets/gazetteer/modern-places.json`，当前 **15,245 条**，约 **2.25 MiB**，字段说明见 `assets/gazetteer/README.md`。

### 2.2 选取与处理

1. 只解析 feature class `P`，feature code 限定为 `PPLA` / `PPLA2` / `PPLA3` / `PPLA4` / `PPLC` / `PPLG` / `PPLS` / `PPL`。
2. 人口 > 0 的记录按人口降序取前 1,200 条，再并上全部 `PPLA*` 行政中心，按 `geonameid` 去重。
3. 丢弃坐标不在 `[70, 15, 140, 55]` 内或字段不完整的记录。
4. 中文名优先：`name` 含汉字则直接使用；否则从 `alternatenames` 中挑选合适汉字写法。`aliases` 去重、最多 8 个、单项不超过 40 字符，包含中文名和 `asciiname`。
5. `admin1` 取自 `admin1CodesASCII.txt` 的英文/拼音名（如 `Hubei`）；若该文件将来出现中文列，脚本会自动优先使用中文列。
6. 先写临时文件，全部校验通过后再 rename；失败不会覆盖已有文件。
7. 当前 `admin2` 字段不写入（未下载 `admin2Codes.txt`，GeoNames `CN.txt` 中只有行政代码）。

刷新命令：

```bash
node scripts/fetch-geonames.mjs
# 或
npm run data:geonames
```

### 2.3 已知限制

- GeoNames `CN.zip` 只覆盖中国大陆；香港、澳门、台湾在 `HK`、`MO`、`TW` 数据包中，本库暂不包含。
- 少数记录（当前 411 条）在 GeoNames 中没有长度为 2 个字符以上的中文 alternate name，`name` 回退为罗马字/原文。
- 坐标来自 GeoNames，未逐点人工核对；本库用于检索和粗定位，不用于精确边界判定。
- 现代地名库与离线底图、历史地名库是独立数据；古今对应关系优先由模型按年代/上下文判断，地名库作回退；不能仅凭同名直接断言。

## 3. 校验测试

```bash
npx vitest run tests/unit/geodata.test.ts
```

测试不联网，会读取上述生成物并断言：

- 文件存在、是合法 GeoJSON `FeatureCollection` / JSON 数组；
- 图层要素与地名条目数量下限；
- 坐标落在 `[70, 15, 140, 55]` 及其 ε 邻域内；
- 底图坐标最多 4 位小数、`metadata.json` 的计数与文件一致；
- 现代地名符合 `ModernPlace` schema、ID 唯一、别名数量/长度限制、主要城市（北京/上海）存在。

如果生成脚本下载失败或输出不完整，应修复网络/上游问题后重跑，**不得**用空文件或伪造数据代替。
