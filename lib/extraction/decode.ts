import chardet from "chardet";
import iconv from "iconv-lite";

import { AppError, ERROR_CODES } from "@/lib/server/http";

export interface DecodedText {
  text: string;
  encoding: string;
}

const UTF8_BOM = "\uFEFF";

function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

function tryDecodeUtf8(buffer: Uint8Array): string | null {
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return stripBom(decoder.decode(buffer));
  } catch {
    return null;
  }
}

function detectEncoding(buffer: Uint8Array): string | null {
  try {
    return chardet.detect(buffer);
  } catch {
    return null;
  }
}

/**
 * chardet reports a zoo of labels; map the ones relevant to this project to
 * labels iconv-lite understands. GB2312/GBK are decoded as GB18030 because the
 * superset handles all of them.
 */
export function normalizeEncodingLabel(label: string | null): string | null {
  if (!label) return null;
  const upper = label.toUpperCase().replace(/\s+/g, "");
  if (upper.includes("UTF-16")) return "utf-16";
  if (upper.includes("UTF-8") || upper.includes("ASCII")) return "utf-8";
  if (
    upper.includes("GB18030") ||
    upper.includes("GBK") ||
    upper.includes("GB2312") ||
    upper.includes("CP936") ||
    upper.includes("EUC-CN")
  ) {
    return "gb18030";
  }
  if (upper.includes("BIG5")) return "big5";
  if (upper.includes("SHIFT")) return "shift_jis";
  if (upper.includes("ISO-8859-1") || upper.includes("WINDOWS-1252")) {
    return "windows-1252";
  }
  return null;
}

function decodeWith(encoding: string, buffer: Uint8Array): string | null {
  try {
    return stripBom(iconv.decode(buffer, encoding));
  } catch {
    return null;
  }
}

/**
 * Decode arbitrary text bytes. Order is deliberately conservative:
 * 1. BOM / strict UTF-8 (most modern texts),
 * 2. chardet's pick (GB18030/Big5/...),
 * 3. GB18030 as the CJK default.
 *
 * The result is never silently empty: undecodable input raises BAD_REQUEST.
 */
export function decodeTextBuffer(buffer: Uint8Array): DecodedText {
  if (buffer.length === 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "文本内容为空");
  }

  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    const text = decodeWith("utf-16le", buffer);
    if (text !== null) return { text, encoding: "utf-16le" };
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const text = decodeWith("utf-16be", buffer);
    if (text !== null) return { text, encoding: "utf-16be" };
  }

  const utf8 = tryDecodeUtf8(buffer);
  if (utf8 !== null) return { text: utf8, encoding: "utf-8" };

  const detected = normalizeEncodingLabel(detectEncoding(buffer));
  if (detected && detected !== "utf-8") {
    const text = decodeWith(detected, buffer);
    if (text !== null) return { text, encoding: detected };
  }

  const gb18030 = decodeWith("gb18030", buffer);
  if (gb18030 !== null) return { text: gb18030, encoding: "gb18030" };

  throw new AppError(
    ERROR_CODES.BAD_REQUEST,
    "无法识别文本编码，请另存为 UTF-8 后重试",
  );
}
