import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  ERROR_CODES,
  errorResponse,
  jsonError,
  jsonOk,
} from "@/lib/server/http";
import { deleteCorrection, listCorrections } from "@/lib/server/store";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const corrections = await listCorrections();
    if (!corrections.some((item) => item.id === id)) {
      return jsonError(ERROR_CODES.BAD_REQUEST, "修正记录不存在", 404);
    }
    await deleteCorrection(id);
    return jsonOk({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
