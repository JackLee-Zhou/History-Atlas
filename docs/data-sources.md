# 数据来源与许可（汇总）

本项目只打包允许再分发或自建的数据。**不包含**《中国历史地图集》、CHGIS 或其他受限数据。

| 数据 | 文件 | 来源 | 许可 | 详细说明 |
| --- | --- | --- | --- | --- |
| 离线底图 | `public/basemap/*.geojson` | Natural Earth 1:50m | Public Domain | [`data-sources-geo.md`](./data-sources-geo.md) |
| 现代地名 | `assets/gazetteer/modern-places.json` | GeoNames `CN.zip` | CC BY 4.0 | [`data-sources-geo.md`](./data-sources-geo.md) |
| 朝代区间 | `assets/gazetteer/dynasties.json` | 项目整理 | 项目自有 | 仅用于地名时期过滤 |
| 古地名 | `assets/gazetteer/ancient-places.json` | 项目整理，逐条写来源 | 项目自有 | [`data-sources-demo.md`](./data-sources-demo.md) |
| 示例书 | `assets/demo/books/three-kingdoms.json` | 中文维基文库《三国演义》第 49/50 回 | 公版 | [`data-sources-demo.md`](./data-sources-demo.md) / [`assets/demo/README.md`](../assets/demo/README.md) |
| 样板分析 | `assets/demo/analyses/chibi.json` | 手工整理，非模型生成 | 项目自有 | [`data-sources-demo.md`](./data-sources-demo.md) |

## 归属文本

- Natural Earth: “Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com.”
- GeoNames: 数据来自 GeoNames（https://www.geonames.org/），按 CC BY 4.0 使用。
- MapLibre GL JS: BSD 3-Clause。
- OpenCC / opencc-js: Apache-2.0。

完整第三方声明见仓库根目录 `NOTICE`。

## 重要限制

- 古地名坐标为**今地近似/示意**，不是考古或导航坐标；学界有争议的地点已在 `note`/`confidence` 中标注。
- 底图是现代底图，省界/海岸线与历史时期并不一致，只用于空间参照。
- 现代地名覆盖中国大陆；香港、澳门、台湾尚未并入当前 GeoNames 子集。
- 古地名库首版 122 条，不能覆盖所有史书；未覆盖地点会进入“待考”，需要模型/人工补足。
- 示例分析的引文全部逐字来自第 50 回；`scripts/validate-assets.ts` 会严格反查 quote 与 offset。
