import path from "node:path";

import { load, type CheerioAPI } from "cheerio";
import JSZip from "jszip";

import { MAX_EPUB_UNCOMPRESSED_BYTES } from "@/lib/constants";
import type { Warning } from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";

import {
  buildChapterContent,
  type ChapterContent,
  deriveTitleFromFilename,
  normalizeParagraphText,
  normalizeTitle,
} from "./content";
import { decodeTextBuffer } from "./decode";
import type { ExtractionOutput, RawChapter } from "./types";
import { extractionWarning } from "./warnings";

const MAX_EPUB_ENTRIES = 5000;
const CONTAINER_PATH = "META-INF/container.xml";

const SKIP_TAGS = new Set([
  "script",
  "style",
  "head",
  "title",
  "nav",
  "noscript",
  "iframe",
  "svg",
  "math",
  "rt",
  "rp",
  "template",
  // Chapter headings are captured as the chapter title; do not duplicate them
  // as body paragraphs (and do not let a heading-only page count as body text).
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "caption",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "html",
  "li",
  "main",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

interface DomNode {
  type?: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

interface OpfData {
  title?: string;
  author?: string;
  items: Map<string, ManifestItem>;
  spine: string[];
  tocId?: string;
  navPath?: string;
}

function localNameOf(element: unknown): string {
  if (!element || typeof element !== "object") return "";
  const name = (element as { name?: unknown }).name;
  return typeof name === "string" ? (name.split(":").pop() ?? "") : "";
}

function elementsByLocalName($: CheerioAPI, name: string) {
  const target = name.toLowerCase();
  return $("*").filter(
    (_, element) => localNameOf(element).toLowerCase() === target,
  );
}

function firstElementText($: CheerioAPI, name: string): string | undefined {
  let value: string | undefined;
  elementsByLocalName($, name).each((_, element) => {
    if (value) return;
    const text = normalizeParagraphText($(element).text());
    if (text) value = text;
  });
  return value;
}

/** Normalize an EPUB-root-relative path; reject traversal outside the archive. */
function normalizeZipPath(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw value when it is not valid percent-encoding.
  }
  value = value.replace(/^\.\//, "").replace(/^\/+/, "");
  const normalized = path.posix.normalize(value);
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return null;
  }
  return normalized;
}

/** Resolve an href relative to the file that declares it (fragment stripped). */
function resolveEpubHref(baseFilePath: string, href: string): string | null {
  const hashIndex = href.indexOf("#");
  const withoutFragment = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  if (!withoutFragment.trim()) return null;
  let decoded = withoutFragment.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // fall through with the raw string
  }
  const directory = path.posix.dirname(baseFilePath);
  const joined = decoded.startsWith("/")
    ? decoded.slice(1)
    : path.posix.join(directory, decoded);
  return normalizeZipPath(joined);
}

function buildZipIndex(zip: JSZip): Map<string, string> {
  const index = new Map<string, string>();
  for (const name of Object.keys(zip.files)) {
    index.set(name, name);
    index.set(name.toLowerCase(), name);
  }
  return index;
}

function resolveZipEntry(index: Map<string, string>, requested: string): string | null {
  const normalized = normalizeZipPath(requested);
  if (!normalized) return null;
  return index.get(normalized) ?? index.get(normalized.toLowerCase()) ?? null;
}

async function readZipBytes(
  zip: JSZip,
  index: Map<string, string>,
  requested: string,
): Promise<Uint8Array | null> {
  const resolved = resolveZipEntry(index, requested);
  if (!resolved) return null;
  const file = zip.file(resolved);
  if (!file || file.dir) return null;
  try {
    const bytes = await file.async("uint8array");
    if (bytes.byteLength > MAX_EPUB_UNCOMPRESSED_BYTES) {
      throw new AppError(
        ERROR_CODES.IMPORT_TOO_LARGE,
        "EPUB 单个条目解压后超过 100MB 安全上限",
        { status: 413 },
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof AppError) throw error;
    return null;
  }
}

async function loadEpubZip(buffer: Uint8Array): Promise<JSZip> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "EPUB 文件损坏或不是有效的 ZIP 容器",
      { status: 415, cause: error },
    );
  }

  const files = Object.values(zip.files);
  if (files.length > MAX_EPUB_ENTRIES) {
    throw new AppError(
      ERROR_CODES.IMPORT_TOO_LARGE,
      `EPUB 条目数超过 ${MAX_EPUB_ENTRIES} 上限`,
      { status: 413 },
    );
  }

  let uncompressed = 0;
  for (const file of files) {
    const internal = (
      file as unknown as { _data?: { uncompressedSize?: number } }
    )._data;
    if (internal?.uncompressedSize) uncompressed += internal.uncompressedSize;
    if (uncompressed > MAX_EPUB_UNCOMPRESSED_BYTES) {
      throw new AppError(
        ERROR_CODES.IMPORT_TOO_LARGE,
        "EPUB 解压后超过 100MB 安全上限",
        { status: 413 },
      );
    }
  }
  return zip;
}

function decodeXmlBytes(bytes: Uint8Array, label: string): string {
  try {
    return decodeTextBuffer(bytes).text;
  } catch (error) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      `EPUB ${label} 编码无法识别`,
      { status: 415, cause: error },
    );
  }
}

function parseOpf(xml: string, opfPath: string): OpfData {
  const $ = load(xml, { xmlMode: true });
  const items = new Map<string, ManifestItem>();

  elementsByLocalName($, "item").each((_, element) => {
    const id = $(element).attr("id")?.trim();
    const href = $(element).attr("href")?.trim();
    if (!id || !href) return;
    const resolved = resolveEpubHref(opfPath, href);
    if (!resolved) return;
    items.set(id, {
      id,
      path: resolved,
      mediaType: $(element).attr("media-type") ?? "",
      properties: ($(element).attr("properties") ?? "")
        .split(/\s+/)
        .filter(Boolean),
    });
  });

  const spine: string[] = [];
  elementsByLocalName($, "itemref").each((_, element) => {
    const idref = $(element).attr("idref")?.trim();
    if (idref) spine.push(idref);
  });

  const spineElement = elementsByLocalName($, "spine").first();
  const tocId = spineElement.attr("toc")?.trim() || undefined;
  const navItem = [...items.values()].find((item) =>
    item.properties.includes("nav"),
  );

  return {
    title: firstElementText($, "title"),
    author: firstElementText($, "creator"),
    items,
    spine,
    tocId,
    navPath: navItem?.path,
  };
}

async function readNavTitles(
  zip: JSZip,
  zipIndex: Map<string, string>,
  navPath: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const bytes = await readZipBytes(zip, zipIndex, navPath);
  if (!bytes) return titles;

  let html: string;
  try {
    html = decodeTextBuffer(bytes).text;
  } catch {
    return titles;
  }

  const $ = load(html);
  const navElements = $("nav").toArray();
  const tocNav =
    navElements.find((nav) => {
      const attribs = nav.attribs ?? {};
      const type = `${attribs["epub:type"] ?? attribs.type ?? ""}`.toLowerCase();
      return type.includes("toc");
    }) ?? navElements[0];

  const anchors = tocNav ? $(tocNav).find("a") : $("a");
  anchors.each((_, anchor) => {
    const href = $(anchor).attr("href");
    const title = normalizeParagraphText($(anchor).text());
    if (!href || !title) return;
    const target = resolveEpubHref(navPath, href);
    if (!target) return;
    if (!titles.has(target)) titles.set(target, title);
  });
  return titles;
}

async function readNcxTitles(
  zip: JSZip,
  zipIndex: Map<string, string>,
  ncxPath: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const bytes = await readZipBytes(zip, zipIndex, ncxPath);
  if (!bytes) return titles;

  let xml: string;
  try {
    xml = decodeTextBuffer(bytes).text;
  } catch {
    return titles;
  }

  const $ = load(xml, { xmlMode: true });
  elementsByLocalName($, "navPoint").each((_, point) => {
    const children = $(point).children().toArray();
    const label = children.find(
      (child) => localNameOf(child).toLowerCase() === "navlabel",
    );
    const content = children.find(
      (child) => localNameOf(child).toLowerCase() === "content",
    );
    if (!label || !content) return;

    const textElement = $(label)
      .find("*")
      .toArray()
      .find((child) => localNameOf(child).toLowerCase() === "text");
    const title = textElement
      ? normalizeParagraphText($(textElement).text())
      : "";
    const src = $(content).attr("src")?.trim();
    if (!title || !src) return;

    const target = resolveEpubHref(ncxPath, src);
    if (target && !titles.has(target)) titles.set(target, title);
  });
  return titles;
}

function collectParagraphs(root: DomNode): string[] {
  const output: string[] = [];
  let buffer = "";

  const flush = (): void => {
    const text = normalizeParagraphText(buffer);
    if (text) output.push(text);
    buffer = "";
  };

  const walk = (node: DomNode): void => {
    if (node.type === "text" || node.type === "cdata") {
      if (node.data) buffer += node.data;
      return;
    }
    if (node.type === "comment" || node.type === "directive") return;
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style" && node.type !== "root") {
      for (const child of node.children ?? []) walk(child);
      return;
    }

    const name = (node.name ?? "").toLowerCase();
    if (SKIP_TAGS.has(name)) return;
    if (name === "br") {
      buffer += " ";
      return;
    }

    const isBlock = BLOCK_TAGS.has(name);
    if (isBlock) flush();
    for (const child of node.children ?? []) walk(child);
    if (isBlock) flush();
  };

  walk(root);
  flush();
  return output;
}

function extractChapterHtml(html: string): {
  content: ChapterContent;
  heading?: string;
} {
  const $ = load(html);

  let heading = "";
  $("h1, h2, h3, h4").each((_, element) => {
    if (heading) return;
    const text = normalizeParagraphText($(element).text());
    if (text) heading = text;
  });
  if (!heading) {
    const documentTitle = normalizeParagraphText($("head title").first().text());
    if (documentTitle) heading = documentTitle;
  }

  $(
    "script, style, head, title, nav, noscript, iframe, svg, math, rt, rp",
  ).remove();

  const body = $("body").first();
  const root = (body.length > 0 ? body.get(0) : $.root().get(0)) as
    | DomNode
    | undefined;
  if (!root) {
    return { content: { text: "", paragraphs: [] }, heading };
  }

  const content = buildChapterContent(collectParagraphs(root));
  return { content, heading: heading || undefined };
}

/**
 * EPUB extraction: container.xml -> OPF manifest/spine -> nav/NCX titles ->
 * per-section paragraphs. Only text is kept; the original XHTML is never
 * returned to the client and the uploaded archive is not persisted.
 */
export async function extractEpub(input: {
  buffer: Uint8Array;
  filename: string;
  title?: string;
}): Promise<ExtractionOutput> {
  const zip = await loadEpubZip(input.buffer);
  const zipIndex = buildZipIndex(zip);

  const containerBytes = await readZipBytes(zip, zipIndex, CONTAINER_PATH);
  if (!containerBytes) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "EPUB 缺少 META-INF/container.xml",
      { status: 415 },
    );
  }

  const containerDoc = load(decodeXmlBytes(containerBytes, "container.xml"), {
    xmlMode: true,
  });
  const rootfile = elementsByLocalName(containerDoc, "rootfile")
    .first()
    .attr("full-path")
    ?.trim();
  const opfPath = rootfile ? normalizeZipPath(rootfile) : null;
  if (!opfPath) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "EPUB 的 container.xml 没有有效的 rootfile 路径",
      { status: 415 },
    );
  }

  const opfBytes = await readZipBytes(zip, zipIndex, opfPath);
  if (!opfBytes) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "EPUB 的 OPF 主文件不存在",
      { status: 415 },
    );
  }

  const opf = parseOpf(decodeXmlBytes(opfBytes, "OPF"), opfPath);
  if (opf.spine.length === 0) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "EPUB 的 OPF 没有可读的 spine",
      { status: 415 },
    );
  }

  const warnings: Warning[] = [];
  const tocTitles = new Map<string, string>();

  const ncxItem =
    (opf.tocId ? opf.items.get(opf.tocId) : undefined) ??
    [...opf.items.values()].find((item) =>
      /dtbncx|ncx/i.test(item.mediaType),
    );
  if (ncxItem) {
    const ncxTitles = await readNcxTitles(zip, zipIndex, ncxItem.path);
    for (const [target, title] of ncxTitles) tocTitles.set(target, title);
  }
  if (opf.navPath) {
    // EPUB 3 nav wins over NCX when both exist.
    const navTitles = await readNavTitles(zip, zipIndex, opf.navPath);
    for (const [target, title] of navTitles) tocTitles.set(target, title);
  }
  if (tocTitles.size === 0) {
    warnings.push(
      extractionWarning(
        "EPUB_NO_TOC",
        "EPUB 未提供可用的 nav/NCX 目录，章节标题取自正文标题",
        "info",
      ),
    );
  }

  const chapters: RawChapter[] = [];
  for (let index = 0; index < opf.spine.length; index += 1) {
    const idref = opf.spine[index];
    const item = opf.items.get(idref);
    if (!item) {
      warnings.push(
        extractionWarning(
          "EPUB_MISSING_MANIFEST_ITEM",
          `spine 引用的条目 ${idref} 不在 manifest 中`,
          "info",
        ),
      );
      continue;
    }
    if (item.path === opf.navPath) continue;
    if (item.mediaType && !/html|xml/i.test(item.mediaType)) continue;

    const bytes = await readZipBytes(zip, zipIndex, item.path);
    if (!bytes) {
      warnings.push(
        extractionWarning(
          "EPUB_MISSING_SPINE_FILE",
          `spine 文件 ${item.path} 无法读取，已跳过`,
          "warning",
        ),
      );
      continue;
    }

    let html: string;
    try {
      html = decodeTextBuffer(bytes).text;
    } catch {
      warnings.push(
        extractionWarning(
          "EPUB_DECODE_FAILED",
          `章节文件 ${item.path} 编码无法识别，已跳过`,
          "warning",
        ),
      );
      continue;
    }

    const { content, heading } = extractChapterHtml(html);
    if (!content.text) continue;

    const fallbackTitle = `第 ${chapters.length + 1} 章`;
    const title = normalizeTitle(
      tocTitles.get(item.path) ?? heading ?? fallbackTitle,
      fallbackTitle,
    );
    chapters.push({
      id: `ch-${index + 1}`,
      title,
      text: content.text,
      paragraphs: content.paragraphs,
      pages: [],
      needsOCR: false,
    });
  }

  if (chapters.length === 0) {
    throw new AppError(
      ERROR_CODES.NO_TEXT_LAYER,
      "EPUB 中没有可读的正文文本",
      { status: 422 },
    );
  }

  const fallbackTitle = deriveTitleFromFilename(input.filename);
  const bookTitle = normalizeTitle(
    input.title?.trim() || opf.title || fallbackTitle,
    fallbackTitle,
  );
  const author = opf.author ? opf.author.slice(0, 200) : undefined;

  return {
    format: "epub",
    title: bookTitle,
    author,
    chapters,
    warnings,
  };
}
