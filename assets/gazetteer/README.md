# 现代地名库（modern-places.json）

`modern-places.json` 是从 GeoNames 中国数据导出的离线现代地名库，供地名检索、古今地名匹配和地图定位使用。文件由脚本生成，**不要手工编辑**。

## 来源与许可

| 数据 | 来源 | 许可 |
| --- | --- | --- |
| 中国地名 | <https://download.geonames.org/export/dump/CN.zip>（`CN.txt`） | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 一级行政区名 | <https://download.geonames.org/export/dump/admin1CodesASCII.txt> | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

- 署名要求：数据来自 **GeoNames**（<https://www.geonames.org/>），按 CC BY 4.0 使用；再分发或展示时请保留本署名和许可说明。
- 本文件是 GeoNames 数据在生成时刻的快照，GeoNames 会持续更新，重新运行脚本可能得到不同的记录。
- 当前生成物：**15,245 条**，JSON 约 **2.25 MiB**。

## 生成命令

```bash
node scripts/fetch-geonames.mjs
# 或
npm run data:geonames
```

脚本会：

1. 下载 `CN.zip` 和 `admin1CodesASCII.txt`（需要网络；失败会重试 3 次后非零退出）；
2. 从 zip 中解出 `CN.txt` 并按 tab 解析；
3. 先写同目录临时文件，校验通过后再 `rename` 为 `modern-places.json`，失败不会留下半成品。

不要在应用运行时调用该脚本；它只用于更新仓库内的种子数据。

## 选取规则

1. 只取 feature class 为 `P` 的记录（populated places）。
2. feature code 限定为 `PPLA`、`PPLA2`、`PPLA3`、`PPLA4`、`PPLC`、`PPLG`、`PPLS`、`PPL`。
3. 人口 `population > 0` 的记录按人口降序取前 **1,200** 条。
4. **并上所有 `PPLA*`**（`PPLA`、`PPLA2`、`PPLA3`、`PPLA4`，即各级行政中心），不论人口是否为 0。
5. 按 `geonameid` 去重；最终 15,245 条（1,200 条人口 Top + 14,888 条 `PPLA*`，重叠 843 条）。
6. 坐标必须落在中国周边窗口 `[70, 15, 140, 55]`（西经/南纬为负）内，否则跳过。

## 字段

数组元素符合 `lib/schema/gazetteer.ts` 的 `ModernPlace`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `string` | 固定格式 `gn-<geonameid>` |
| `name` | `string` | 展示名。优先中文；若无中文 alternate name，则回退 GeoNames 原名/罗马字 |
| `aliases` | `string[]` | 去重别名，最多 8 个，单项不超过 40 字符；包含中文名、`asciiname` 和部分 alternate names |
| `lat` | `number` | WGS84 纬度（保留至多 5 位小数） |
| `lng` | `number` | WGS84 经度（保留至多 5 位小数） |
| `admin1` | `string?` | 一级行政区英文/拼音名，如 `Hubei`，来自 `admin1CodesASCII.txt` |
| `admin2` | — | 当前不写入：GeoNames 的 `admin2` 只是代码，本脚本未下载 `admin2Codes.txt` |
| `population` | `number?` | 仅当 GeoNames 人口 > 0 时写入 |
| `geonameId` | `number` | GeoNames 主键 |

## 中文名的选择

- 若 GeoNames 的 `name` 本身含中日韩汉字，直接使用；
- 否则从 `alternatenames` 中挑选只含汉字（及常见分隔符）、长度 2–40 的候选；
- 候选排序：优先“是更长候选的前缀”的写法（如 `成都` 优先于 `成都市`），再按长度和出现顺序。该启发式不保证与官方译名完全一致，遇到歧义时以 `alternatenames` 中的其他写法作为别名词兜底。

`aliases` 中会保留繁体、历史名等 GeoNames 提供的写法（例如广州的 `廣州`、深圳的 `宝安`），便于检索。

## 已知限制

- `CN.zip` 只覆盖中国大陆；香港、澳门、台湾分别位于 GeoNames 的 `HK`、`MO`、`TW` 数据包中，**本文件不包含**。
- 411 条记录没有长度为 2 个字符以上的中文 alternate name（其中 410 条为纯罗马字记录，1 条只有单个汉字写法 `渠`），展示名回退为罗马字/原文。
- 2 条记录没有可用的 `admin1` 映射（GeoNames 记录本身缺少有效一级行政区代码），字段省略。
- 坐标为 GeoNames 坐标，未做人工逐点核对；精度按 GeoNames 原始数据，不代表实测点位。
- 本文件只服务于检索与粗定位，不能替代行政区划或测绘数据。
