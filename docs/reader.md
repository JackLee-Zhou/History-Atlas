# 导入与阅读器（P0 纵向切片）

本文件说明 P0 的抽取层、书目 API、书库组件与阅读器组件。类型仍以
`lib/schema/book.ts` 为准，跨模块契约见 `docs/contracts.md`。

## 1. 抽取入口

```ts
import { extractBook, type ExtractInput, type ExtractResult } from "@/lib/extraction";

const result = await extractBook({
  buffer,          // Uint8Array，最多 20MB
  filename: "三国演义.epub",
  format: "epub",  // 可省略；仅 "paste" 会绕过魔数检测
  title: "三国演义", // 可省略；默认取元数据或文件名
});
// result.book     -> Book（章节元数据 + warnings）
// result.chapters -> Chapter[]（含 text/paragraphs/pages/needsOCR）
```

- 格式由 `file-type` 读取魔数决定，**不信任扩展名**。无魔数的内容按纯文本
  处理，并拒绝二进制特征明显的载荷。
- 大小：文件 20MB（`MAX_IMPORT_BYTES`）；EPUB 解压总量 100MB、条目 5000。
- 失败一律抛 `AppError`，不会静默返回空书：

| code | 场景 |
| --- | --- |
| `IMPORT_TOO_LARGE`（413） | 超过文件 / 解压上限 |
| `UNSUPPORTED_FORMAT`（415） | 未知或伪装的二进制、损坏的 ZIP/EPUB |
| `BAD_REQUEST`（400） | 空文本、无法识别编码、请求格式不对 |
| `NO_TEXT_LAYER`（422） | EPUB 无正文；PDF 无文本层 / 加密 |

### 偏移不变量

`lib/extraction/content.ts` 是唯一构造章节文本的地方：

```
chapter.text = chapter.paragraphs.map(p => p.text).join("\n\n")
chapter.text.slice(p.start, p.start + p.text.length) === p.text
```

`extractBook` 在返回前用 `validateChapterOffsets` 再校验一次。所有
citation/analysis 的 offset 都相对 `Chapter.text`。

## 2. 各格式行为

### EPUB

- 用 `jszip` 解压、`cheerio` 解析 `META-INF/container.xml`、OPF
  manifest/spine、EPUB3 nav 与 EPUB2 NCX（nav 优先）。
- spine 顺序决定稳定章节 id（`ch-<spineIndex+1>`；跳过空文件时 id 不变）。
- 每章标题优先 nav/NCX，其次正文第一个 `h1`–`h4`，最后 `第 N 章`。
- 正文按块级元素（p/div/li/blockquote/td/...）转段落；`script/style/nav`
  及标题标签被忽略，`br` 转空格。不保存、不返回原始 XHTML。
- 没有目录时产生 `EPUB_NO_TOC`（info）；缺失 spine 文件/编码失败会记录
  warning 并跳过该章。

### PDF

- 使用 `pdfjs-dist` legacy build，动态导入
  `pdfjs-dist/legacy/build/pdf.mjs`，参数含 `useWorkerFetch:false`、
  `isEvalSupported:false`（v6 的类型已移除该键，运行时仍安全传入）。
- 逐页读取文本层；`pages: {number,start,end}` 的 offset 相对本章
  `chapter.text`，**end 为开区间**。
- 有 outline 时按 outline 分章（嵌套条目展平，最多 3 层；同页去重），
  否则整本一章「全文」。
- 每页平均文本少于 20 字符：`needsOCR = true`，返回已有章节并记
  `PDF_NEEDS_OCR` warning；文本层完全为空则抛 `NO_TEXT_LAYER`。
- 读取结束后调用 `loadingTask.destroy()` 释放 worker。

### TXT / 粘贴

- `chardet` 检测 + `iconv-lite` 解码：先严格 UTF-8，再按检测结果
  （GB18030/Big5/...），最后回退 GB18030。
- 按行成段，识别 `第X回/章/节/卷/篇/部/集`、`卷X`、`楔子/序章/前言/...`；
  至少两个标题才切章，否则按约 8000 字在段落边界切分并记
  `TXT_AUTO_SPLIT`（info）。短于 80 字的卷首并入第一章，否则独立「卷首」。
- 粘贴走 JSON `{ title, text }`，在 UTF-8 文本上复用同一套分章逻辑，
  `Book.format` 记为 `paste`。

## 3. 书目 API（Node runtime）

| 方法与路径 | 成功响应 | 说明 |
| --- | --- | --- |
| `GET /api/books` | `{ books, demoSeeded }` | 按导入时间倒序；`demoSeeded` 与 contracts 对齐 |
| `POST /api/books` | `{ book }`（201） | multipart `file` + 可选 `title`，或 JSON `{title?,text}` |
| `GET /api/books/:id` | `{ book }` | 404 `BOOK_NOT_FOUND` |
| `DELETE /api/books/:id` | `{ ok: true }` | 同源校验；同时清理该书 analyses |
| `GET /api/books/:id/chapters/:cid` | `{ chapter }` | 404 `CHAPTER_NOT_FOUND` |

- `POST`/`DELETE` 调 `assertSameOrigin`；路径 id 仅允许
  `[A-Za-z0-9][A-Za-z0-9_-]{0,199}`，避免落到 `.data` 目录之外。
- 只持久化抽取后的 `Book + Chapter[]`（SQLite `books` 表）；原始
  上传字节不写盘、不返回。
- 错误格式统一 `{ error: { code, message } }`。

## 4. 阅读器

### `ReaderPane`（`components/reader`）

```tsx
<ReaderPane
  chapter={chapter}
  highlight={citation ? { start: citation.start, end: citation.end } : null}
  currentPage={page}
  busy={analyzing}
  onAnalyze={(input) => { /* input.scope: selection|page|paragraph|chapter */ }}
  previousChapter={previous}
  nextChapter={next}
  onNavigateChapter={(id) => router.push(`/book/${bookId}/${id}`)}
/>
```

- 只负责渲染与触发，**不发起 fetch**；父组件负责调用分析接口。
- 每段 `<p data-pstart={absoluteOffset}>`，跨段选区通过段落起点 + 段内
  `Range.toString().length` 换算，得到相对 `chapter.text` 的 offset。
- 选区操作条（仅在有选区时出现）：「还原态势」「本段态势」（选区在单段内时）
  「取消」。移动端固定在底部，桌面端位于阅读区底部。
- 无选区时不显示底部操作条；整章生成只保留页面右上角的按钮。
- 正文末尾有「上一章 / 下一章」导航，按书内章节顺序切换；首章/末章对应按钮禁用。
- PDF 在页边界显示「第 N 页 / 本页态势」，`currentPage` 会滚动到对应页
  分隔；`highlight` 会滚动到首个命中段落并加 `.reader-paragraph-highlight`。
- 字号小/中/大存 `localStorage` 键 `history-atlas.reader.font-size`。
- 所有操作按钮都有 `aria-label`；正文是纯文本节点，不使用 `innerHTML`。

### 选区工具（`lib/client/reader.ts`）

```ts
getSelectionOffsets(container, chapter.text) // -> {start,end,text} | null
getParagraphRange(chapter, offset)           // -> 段落范围
getPageRange(chapter, pageNumber)            // -> 页范围
getPageForOffset(chapter, offset)
getChapterOffsetAtNode(container, node, offset)
getParagraphOffsetsAtPoint(container, { x, y }) // 布局 API，jsdom 中不可测
```

- 选区超界、在阅读器外、或折叠时返回 `null`。
- 返回的 offset 会去掉首尾空白；`selectedText` 直接由 `chapter.text` 切片，
  与服务端按 offset 校验的文本保持一致。
- 支持全选（边界落在容器元素本身）与跨段选择。

### `LibraryHome` / `BookCover`（`components/library`）

- `LibraryHome` 负责 `/api/books` 数据、最后阅读位置、导入文件、
  删除确认、继续阅读条和书目网格；导入通过隐藏 file input，删除复用
  Radix Dialog，sonner 只在成功/失败时提示。
- 继续阅读位置存在 `localStorage` 键 `history-atlas.last-read`，百分比按
  最后阅读章节在书内的序号估算；夜间模式复用全局 CSS 变量。
- `BookCover` 按书 ID 的稳定哈希生成五种抽象封面（布面/纸签/星图/指纹/
  山影），不下载或复制受版权保护的封面图；同书重复渲染样式不变。
- 空态提供「放入赤壁示例」；设置页保留模型配置与数据署名。

## 5. 验证

```bash
npx tsc --noEmit
npx vitest run tests/unit/extraction.test.ts tests/unit/selection.test.ts
```

测试覆盖：GB18030 TXT 切章与偏移、8000 字回退、粘贴、空文本、超限、伪装
格式、EPUB（nav/NCX/无目录/空正文/脚本样式忽略）、程序化生成的小 PDF
（文本层、outline 分章、稀疏 needsOCR、无文本报错）、jsdom 单段/跨段/全选
偏移与页范围。没有网络请求，也没有真实用户书稿 fixture。

## 6. 已知限制

- 不做 OCR；扫描 PDF 只标记 `needsOCR`。
- PDF 分章依赖 outline；无 outline 的书只能整本一章。PDF 的页内段落合并是
  启发式的（按句末标点），可能把无标点的短行并成一段。
- EPUB 只处理 XHTML 文本；图片、脚注弹层、ruby 注音会被忽略。
- TXT 的章节识别是正则启发式，非标准格式可能走 8000 字回退。
- 阅读器高亮按段落下发 CSS 类，不做段内字符级高亮；citation 精度仍以 offset
  为准。
