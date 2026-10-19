import { fileTypeFromBuffer } from "file-type";

import { MAX_IMPORT_BYTES } from "@/lib/constants";
import type { BookFormat } from "@/lib/schema";
import { AppError, ERROR_CODES } from "@/lib/server/http";

import type { ExtractInput } from "./types";

const MB = 1024 * 1024;

export function assertImportSize(byteLength: number): void {
  if (!Number.isFinite(byteLength) || byteLength <= 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "文件为空，无法导入");
  }
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new AppError(
      ERROR_CODES.IMPORT_TOO_LARGE,
      `文件超过 ${Math.round(MAX_IMPORT_BYTES / MB)}MB 上限`,
      { status: 413 },
    );
  }
}

/**
 * Plain text has no magic number. Reject binary-looking payloads so a renamed
 * image/database cannot be accepted as a "TXT".
 */
function assertLooksLikeText(buffer: Uint8Array): void {
  // UTF-16 text legitimately contains NUL bytes; decodeTextBuffer handles BOMs.
  if (
    (buffer[0] === 0xff && buffer[1] === 0xfe) ||
    (buffer[0] === 0xfe && buffer[1] === 0xff)
  ) {
    return;
  }

  const sampleLength = Math.min(buffer.length, 8192);
  if (sampleLength === 0) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "文本内容为空");
  }
  let suspicious = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index];
    if (byte === 0) {
      suspicious += 4;
    } else if (byte < 9 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }
  if (suspicious / sampleLength > 0.02) {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "文件不是可识别的 EPUB、PDF 或纯文本",
      { status: 415 },
    );
  }
}

function mismatch(format: BookFormat, detected: string): AppError {
  return new AppError(
    ERROR_CODES.UNSUPPORTED_FORMAT,
    `文件内容与所选格式不符（检测为 ${detected}，声明为 ${format}）`,
    { status: 415 },
  );
}

/**
 * Resolve the real input format from magic bytes, never from the extension.
 * JSON-pasted text declares `format: "paste"` and is already UTF-8.
 */
export async function resolveImportFormat(
  input: ExtractInput,
): Promise<BookFormat> {
  if (input.format === "paste") return "paste";

  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(input.buffer);
  } catch {
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      "无法读取文件类型，文件可能已损坏",
      { status: 415 },
    );
  }

  if (detected) {
    if (detected.ext === "epub") {
      if (input.format && input.format !== "epub") {
        throw mismatch(input.format, "EPUB");
      }
      return "epub";
    }
    if (detected.ext === "pdf") {
      if (input.format && input.format !== "pdf") {
        throw mismatch(input.format, "PDF");
      }
      return "pdf";
    }
    if (detected.ext === "zip") {
      throw new AppError(
        ERROR_CODES.UNSUPPORTED_FORMAT,
        "压缩包不是有效的 EPUB（缺少 mimetype）",
        { status: 415 },
      );
    }
    throw new AppError(
      ERROR_CODES.UNSUPPORTED_FORMAT,
      `不支持的文件格式（${detected.mime}），请上传 EPUB、PDF 或 TXT`,
      { status: 415 },
    );
  }

  if (input.format && input.format !== "txt") {
    throw mismatch(input.format, "纯文本");
  }
  assertLooksLikeText(input.buffer);
  return "txt";
}
