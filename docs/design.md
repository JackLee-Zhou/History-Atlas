# 界面设计

## 书架主页

主页是一张现代书架，而不是营销落地页：

- 中性纸白背景，红色“阅”印记 + “我的书架”大标题；
- “导入书籍”是唯一实心主操作；
- 继续阅读条显示书封、书名、最后阅读进度和“接着读”；
- “全部 / 最近阅读”下面为五列书目网格，书封下方显示书名、作者；
- 书目不足一行时显示一个书形的导入位，不塞假书或空白占位。

字号层级：主标题 `clamp(2.6rem, 4vw, 3.5rem)`，副标题 `1.05rem`，正文 `0.875–1rem`。界面字体使用系统中文无衬线；书封标题与阅读页使用自托管的 Noto Serif SC。

## 全局阅读背景

阅读器右上角“背景”提供宣纸、米白、月白、陶土、竹青、夜间六套背景。选择保存在
`localStorage` 的 `history-atlas.reading-background-v2`，通过 CSS 变量全局生效；
夜间模式同步切换文字、边框、面板与舆图浮层。

## 书封

`components/library/BookCover.tsx` 使用书籍 ID 的稳定哈希生成五种抽象封面：

1. 朱砂（山影与树）；
2. 夜蓝（行星与轨道）；
3. 纸白（指纹）；
4. 墨绿（书签与山形）；
5. 雾绿（层叠山林）。

书封不下载、不复制受版权保护的封面图；同一本书在刷新后样式不变。封面右下边缘有书页
侧边，标题按书名长度自动缩放。

## 阅读页

- 居中书页、页首卷名、首字下沉、页边与卷尾；
- 顶部工具栏只保留章节、模型/背景入口、态势开关；
- 阅读器与舆图可拖动分隔，舆图可整体收起；
- 舆图浮层使用独立的背景与文字颜色，保证夜间可读。

## 开源参考

只参考交互与视觉语言，未复制代码或素材：

- [Calibre-Web](https://github.com/janeczku/calibre-web) — 数字书库的信息层级；
- [Koodo Reader](https://github.com/koodo-reader/koodo-reader) — 长文阅读器的克制工具栏；
- [Readest](https://github.com/readest/readest) — 阅读专注与留白；
- [huashu-design](https://github.com/alchaincyf/huashu-design)（MIT）— 中文排印与设计评审参考；
- [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC) — SIL OFL 1.1，自托管。

地图、底图与数据来源见 [data-sources.md](data-sources.md) 与根目录 `NOTICE`。
