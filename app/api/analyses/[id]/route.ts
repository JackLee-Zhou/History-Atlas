import { ERROR_CODES, errorResponse, jsonError, jsonOk } from "@/lib/server/http";
import { getAnalysis } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analyses/:id
 * Returns a stored analysis. Next 16 passes dynamic route params as a Promise.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    const analysis = await getAnalysis(id);
    if (!analysis) {
      return jsonError(
        ERROR_CODES.ANALYSIS_NOT_FOUND,
        "分析不存在或已删除。",
        404,
      );
    }
    return jsonOk({ analysis });
  } catch (error) {
    return errorResponse(error);
  }
}
