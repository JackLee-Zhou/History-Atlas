import {
  AppError,
  ERROR_CODES,
  assertSameOrigin,
  errorResponse,
  jsonOk,
} from "@/lib/server/http";
import { deleteBook, getBook } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function parseBookId(raw: string): string {
  if (!SAFE_ID.test(raw)) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "无效的书目 ID");
  }
  return raw;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const book = await getBook(parseBookId(id));
    if (!book) {
      throw new AppError(ERROR_CODES.BOOK_NOT_FOUND, "未找到该书", {
        status: 404,
      });
    }
    return jsonOk({ book });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    await deleteBook(parseBookId(id));
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
