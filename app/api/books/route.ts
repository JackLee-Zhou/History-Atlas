import { z } from "zod";

import { DEMO_BOOK_ID, MAX_IMPORT_BYTES } from "@/lib/constants";
import { extractBook } from "@/lib/extraction";
import {
  AppError,
  ERROR_CODES,
  assertSameOrigin,
  errorResponse,
  jsonOk,
  readJsonBody,
} from "@/lib/server/http";
import { listBooks, saveStoredBook } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pasteRequestSchema = z.object({
  title: z.string().trim().max(200).optional(),
  text: z
    .string()
    .min(1, "文本不能为空")
    .max(MAX_IMPORT_BYTES, "文本超过 20MB 上限"),
});

function assertRequestSize(request: Request): void {
  const rawLength = request.headers.get("content-length");
  if (!rawLength) return;
  const length = Number(rawLength);
  if (
    Number.isFinite(length) &&
    length > MAX_IMPORT_BYTES + 1024 * 1024
  ) {
    throw new AppError(
      ERROR_CODES.IMPORT_TOO_LARGE,
      "请求体超过 20MB 上限",
      { status: 413 },
    );
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    "name" in value
  );
}

export async function GET() {
  try {
    const books = await listBooks();
    return jsonOk({
      books,
      demoSeeded: books.some((book) => book.id === DEMO_BOOK_ID),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Import a book from either:
 * - multipart/form-data with a `file` field (EPUB/PDF/TXT), or
 * - JSON `{ title?, text }` for pasted text.
 *
 * The raw upload is never returned or persisted; only the extracted Book +
 * Chapter data is written to the SQLite books table.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRequestSize(request);

    const contentType = request.headers.get("content-type") ?? "";
    let result;

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "无法读取上传的表单数据");
      }

      const file = form.get("file");
      if (!isUploadedFile(file)) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "缺少上传文件字段 file");
      }
      if (file.size === 0) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "上传文件为空");
      }
      if (file.size > MAX_IMPORT_BYTES) {
        throw new AppError(
          ERROR_CODES.IMPORT_TOO_LARGE,
          "文件超过 20MB 上限",
          { status: 413 },
        );
      }

      const titleField = form.get("title");
      const title =
        typeof titleField === "string" && titleField.trim()
          ? titleField.trim()
          : undefined;
      const buffer = new Uint8Array(await file.arrayBuffer());

      result = await extractBook({
        buffer,
        filename: file.name || "upload",
        title,
      });
    } else if (contentType.includes("application/json")) {
      const body = await readJsonBody(request, pasteRequestSchema);
      const bytes = new TextEncoder().encode(body.text);
      const title = body.title?.trim() || undefined;

      result = await extractBook({
        buffer: bytes,
        filename: "paste.txt",
        format: "paste",
        title,
      });
    } else {
      throw new AppError(
        ERROR_CODES.UNSUPPORTED_FORMAT,
        "请上传 EPUB/PDF/TXT 文件，或以 JSON 粘贴文本",
        { status: 415 },
      );
    }

    await saveStoredBook({ book: result.book, chapters: result.chapters });
    return jsonOk({ book: result.book }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
