import {
  AppError,
  ERROR_CODES,
  errorResponse,
  jsonOk,
} from "@/lib/server/http";
import { getChapter } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function parseId(raw: string, label: string): string {
  if (!SAFE_ID.test(raw)) {
    throw new AppError(ERROR_CODES.BAD_REQUEST, `无效的${label}`);
  }
  return raw;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; chapterId: string }> },
) {
  try {
    const { id, chapterId } = await params;
    const chapter = await getChapter(
      parseId(id, "书目 ID"),
      parseId(chapterId, "章节 ID"),
    );
    if (!chapter) {
      throw new AppError(ERROR_CODES.CHAPTER_NOT_FOUND, "未找到该章节", {
        status: 404,
      });
    }
    return jsonOk({ chapter });
  } catch (error) {
    return errorResponse(error);
  }
}
