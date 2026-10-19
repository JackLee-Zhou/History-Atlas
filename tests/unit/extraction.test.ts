import { describe, expect, it, vi } from "vitest";
import iconv from "iconv-lite";
import JSZip from "jszip";

// The extraction layer throws the project's AppError from lib/server/http, which
// imports the server-only guard. Unit tests run in Node, so neutralize it.
vi.mock("server-only", () => ({}));

import type { Chapter } from "@/lib/schema";
import { MAX_IMPORT_BYTES } from "@/lib/constants";
import { extractBook } from "@/lib/extraction";

function encoder(): TextEncoder {
  return new TextEncoder();
}

function expectChapterInvariant(chapter: Chapter): void {
  expect(chapter.text).toBe(
    chapter.paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
  );
  chapter.paragraphs.forEach((paragraph, index) => {
    expect(chapter.text.slice(paragraph.start, paragraph.start + paragraph.text.length)).toBe(
      paragraph.text,
    );
    if (index > 0) {
      const previous = chapter.paragraphs[index - 1];
      expect(paragraph.start).toBe(
        previous.start + previous.text.length + 2,
      );
    } else {
      expect(paragraph.start).toBe(0);
    }
  });
  expect(chapter.bookId.length).toBeGreaterThan(0);
}

type TocKind = "nav" | "ncx" | "none";

function escapePdfString(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

/**
 * Build a tiny, fully self-contained PDF (no network, no fixture binary).
 * Object numbering: 1 catalog, 2 pages, 3 font, then page/content pairs,
 * then the optional outline root + items.
 */
function buildPdf(pages: string[], outlinePages: string[] = []): Uint8Array {
  const pageObjects = pages.map((_, index) => 4 + index * 2);
  const outlineRoot = 4 + pages.length * 2;
  const hasOutline = outlinePages.length > 0;

  const objects: string[] = [];
  objects.push(
    `<< /Type /Catalog /Pages 2 0 R${hasOutline ? ` /Outlines ${outlineRoot} 0 R` : ""} >>`,
  );
  objects.push(
    `<< /Type /Pages /Kids [${pageObjects.map((num) => `${num} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  pages.forEach((text, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    const content = text
      ? `BT /F1 24 Tf 72 720 Td (${escapePdfString(text)}) Tj ET`
      : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNumber} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    objects.push(
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    );
  });

  if (hasOutline) {
    const itemNumbers = outlinePages.map((_, index) => outlineRoot + 1 + index);
    objects.push(
      `<< /Type /Outlines /First ${itemNumbers[0]} 0 R /Last ${itemNumbers[itemNumbers.length - 1]} 0 R /Count ${outlinePages.length} >>`,
    );
    outlinePages.forEach((title, index) => {
      const pageNumber = pageObjects[index];
      const next =
        index + 1 < itemNumbers.length ? ` /Next ${itemNumbers[index + 1]} 0 R` : "";
      const previous = index > 0 ? ` /Prev ${itemNumbers[index - 1]} 0 R` : "";
      objects.push(
        `<< /Title (${escapePdfString(title)}) /Parent ${outlineRoot} 0 R /Dest [${pageNumber} 0 R /Fit]${previous}${next} >>`,
      );
    });
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(encoder().encode(pdf));
}

async function buildEpub(options: { empty?: boolean; toc?: TocKind } = {}): Promise<Uint8Array> {
  const toc = options.toc ?? "nav";
  const empty = options.empty ?? false;
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const navItem =
    toc === "nav"
      ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : "";
  const ncxItem =
    toc === "ncx"
      ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
      : "";
  const spineToc = toc === "ncx" ? ' toc="ncx"' : "";

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>测试史书</dc:title>
    <dc:creator>测试作者</dc:creator>
  </metadata>
  <manifest>
    ${navItem}
    ${ncxItem}
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine${spineToc}>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`,
  );

  if (toc === "nav") {
    zip.file(
      "OEBPS/nav.xhtml",
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>目录</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="ch1.xhtml">第一回 桃园</a></li>
        <li><a href="text/ch2.xhtml">第二回 赤壁</a></li>
      </ol>
    </nav>
  </body>
</html>`,
    );
  }

  if (toc === "ncx") {
    zip.file(
      "OEBPS/toc.ncx",
      `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>第一回 桃园</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
    <navPoint id="n2" playOrder="2">
      <navLabel><text>第二回 赤壁</text></navLabel>
      <content src="text/ch2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`,
    );
  }

  zip.file(
    "OEBPS/ch1.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>内页标题不应成为章节标题</title>
    <style>.hidden { color: red; }</style>
    <script>var secret = "不要出现在正文";</script>
  </head>
  <body>
    <h1>第一回 桃园</h1>
    ${empty ? "<p> </p>" : "<p>刘备、关羽、张飞相遇于桃园。</p>"}
    ${
      empty
        ? ""
        : '<div><p>他们结为兄弟。</p><script>alert("脚本不应出现")</script></div><p>第二段<br/>换行。</p>'
    }
  </body>
</html>`,
  );

  zip.file(
    "OEBPS/text/ch2.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>第二回</title></head>
  <body>
    <h1>第二回 赤壁</h1>
    ${empty ? "<p> </p>" : "<p>曹操军顺江东下。</p><p>孙刘联军溯江西上。</p>"}
  </body>
</html>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return new Uint8Array(bytes);
}

describe("extractBook · TXT", () => {
  it("splits 第X回 headings and keeps paragraph offsets consistent (GB18030)", async () => {
    const text = [
      "第一回 宴桃园豪杰三结义",
      "",
      "刘备、关羽、张飞相遇于桃园。",
      "三人结为兄弟。",
      "",
      "第二回 张翼德怒鞭督邮",
      "",
      "张飞怒鞭督邮，弃官而去。",
    ].join("\n");
    const buffer = new Uint8Array(iconv.encode(text, "gb18030"));

    const result = await extractBook({ buffer, filename: "三国演义.txt" });

    expect(result.book.format).toBe("txt");
    expect(result.book.title).toBe("三国演义");
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      "第一回 宴桃园豪杰三结义",
      "第二回 张翼德怒鞭督邮",
    ]);
    for (const chapter of result.chapters) expectChapterInvariant(chapter);
    expect(result.chapters[0].paragraphs.map((p) => p.text)).toEqual([
      "刘备、关羽、张飞相遇于桃园。",
      "三人结为兄弟。",
    ]);
    expect(result.book.chapters[0].charCount).toBe(
      result.chapters[0].text.length,
    );
    expect(result.book.chapters[0].index).toBe(0);
  });

  it("falls back to ~8000-char chunks on paragraph boundaries", async () => {
    const paragraphs = Array.from({ length: 60 }, (_, index) => {
      return `第${index}段内容。` + "史".repeat(200);
    });
    const buffer = new Uint8Array(
      encoder().encode(paragraphs.join("\n")),
    );

    const result = await extractBook({ buffer, filename: "长篇.txt" });

    expect(result.chapters.length).toBeGreaterThan(1);
    expect(
      result.book.warnings.some((warning) => warning.code === "TXT_AUTO_SPLIT"),
    ).toBe(true);
    for (const chapter of result.chapters) {
      expectChapterInvariant(chapter);
      expect(chapter.text.length).toBeLessThanOrEqual(8000 + 260);
    }
  });

  it("ignores a misleading extension and detects plain text from content", async () => {
    const text = "第一回 甲\n\n正文一。\n\n第二回 乙\n\n正文二。";
    const result = await extractBook({
      buffer: new Uint8Array(encoder().encode(text)),
      filename: "其实是文本.pdf",
    });
    expect(result.book.format).toBe("txt");
    expect(result.chapters).toHaveLength(2);
  });

  it("supports JSON-pasted text with format=paste", async () => {
    const text = "第一回 甲\n\n正文一。\n\n第二回 乙\n\n正文二。";
    const result = await extractBook({
      buffer: new Uint8Array(encoder().encode(text)),
      filename: "paste.txt",
      format: "paste",
      title: "粘贴史书",
    });
    expect(result.book.format).toBe("paste");
    expect(result.book.title).toBe("粘贴史书");
    expect(result.chapters).toHaveLength(2);
    for (const chapter of result.chapters) expectChapterInvariant(chapter);
  });

  it("rejects empty and blank text", async () => {
    await expect(
      extractBook({ buffer: new Uint8Array(), filename: "empty.txt" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      extractBook({
        buffer: new Uint8Array(encoder().encode("   \n\n \t ")),
        filename: "blank.txt",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects oversized imports before parsing", async () => {
    await expect(
      extractBook({
        buffer: new Uint8Array(MAX_IMPORT_BYTES + 1),
        filename: "huge.txt",
      }),
    ).rejects.toMatchObject({ code: "IMPORT_TOO_LARGE", status: 413 });
  });

  it("rejects unsupported binary content even with a .txt name", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
      0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
    ]);
    await expect(
      extractBook({ buffer: png, filename: "伪装.txt" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT", status: 415 });
  });

  it("rejects a plain zip that is not an EPUB", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hello");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(
      extractBook({ buffer: new Uint8Array(bytes), filename: "book.epub" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });
});

describe("extractBook · EPUB", () => {
  it("reads OPF title/author, nav titles and paragraph text (ignoring script/style)", async () => {
    const buffer = await buildEpub();

    const result = await extractBook({ buffer, filename: "测试.epub" });

    expect(result.book.format).toBe("epub");
    expect(result.book.title).toBe("测试史书");
    expect(result.book.author).toBe("测试作者");
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters.map((chapter) => chapter.id)).toEqual([
      "ch-1",
      "ch-2",
    ]);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      "第一回 桃园",
      "第二回 赤壁",
    ]);

    for (const chapter of result.chapters) expectChapterInvariant(chapter);

    const firstText = result.chapters[0].text;
    expect(firstText).toContain("刘备、关羽、张飞相遇于桃园。");
    expect(firstText).toContain("他们结为兄弟。");
    expect(firstText).toContain("第二段 换行。");
    expect(firstText).not.toContain("脚本不应出现");
    expect(firstText).not.toContain("不要出现在正文");
  });

  it("falls back to NCX titles when the EPUB has no nav document", async () => {
    const buffer = await buildEpub({ toc: "ncx" });
    const result = await extractBook({ buffer, filename: "ncx.epub" });
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      "第一回 桃园",
      "第二回 赤壁",
    ]);
  });

  it("uses heading titles and warns when no TOC exists", async () => {
    const buffer = await buildEpub({ toc: "none" });
    const result = await extractBook({ buffer, filename: "no-toc.epub" });
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      "第一回 桃园",
      "第二回 赤壁",
    ]);
    expect(
      result.book.warnings.some((warning) => warning.code === "EPUB_NO_TOC"),
    ).toBe(true);
  });

  it("raises NO_TEXT_LAYER for an EPUB with no readable body", async () => {
    const buffer = await buildEpub({ empty: true });
    await expect(
      extractBook({ buffer, filename: "empty.epub" }),
    ).rejects.toMatchObject({ code: "NO_TEXT_LAYER" });
  });
});

describe("extractBook · PDF", () => {
  it("extracts page text, page offsets and a no-outline warning", async () => {
    const result = await extractBook({
      buffer: buildPdf(["Hello world. This is a PDF text layer."]),
      filename: "sample.pdf",
    });

    expect(result.book.format).toBe("pdf");
    expect(result.book.title).toBe("sample");
    expect(result.chapters).toHaveLength(1);
    const chapter = result.chapters[0];
    expect(chapter.title).toBe("全文");
    expect(chapter.text).toContain("Hello world. This is a PDF text layer.");
    expect(chapter.needsOCR).toBe(false);
    expect(chapter.pages).toHaveLength(1);
    expect(chapter.pages[0]).toMatchObject({ number: 1, start: 0 });
    expect(chapter.pages[0].end).toBeGreaterThan(0);
    expect(chapter.pages[0].end).toBeLessThanOrEqual(chapter.text.length);
    expectChapterInvariant(chapter);
    expect(
      result.book.warnings.some((warning) => warning.code === "PDF_NO_OUTLINE"),
    ).toBe(true);
  }, 30_000);

  it("splits chapters from the PDF outline", async () => {
    const result = await extractBook({
      buffer: buildPdf(
        ["Alpha page one.", "Beta page two."],
        ["Chapter One", "Chapter Two"],
      ),
      filename: "outline.pdf",
    });

    expect(result.chapters).toHaveLength(2);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(result.chapters[0].text).toContain("Alpha page one.");
    expect(result.chapters[1].text).toContain("Beta page two.");
    for (const chapter of result.chapters) expectChapterInvariant(chapter);
  }, 30_000);

  it("marks a sparse text layer as needsOCR instead of silently succeeding", async () => {
    const result = await extractBook({
      buffer: buildPdf(["Hi"]),
      filename: "scan.pdf",
    });
    expect(result.chapters[0].needsOCR).toBe(true);
    expect(
      result.book.warnings.some((warning) => warning.code === "PDF_NEEDS_OCR"),
    ).toBe(true);
  }, 30_000);

  it("raises NO_TEXT_LAYER when a PDF has no text at all", async () => {
    await expect(
      extractBook({ buffer: buildPdf([""]), filename: "blank.pdf" }),
    ).rejects.toMatchObject({ code: "NO_TEXT_LAYER", status: 422 });
  }, 30_000);
});
