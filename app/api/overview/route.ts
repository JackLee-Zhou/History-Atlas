import { NextResponse } from "next/server";

import { overviewInputSchema } from "@/lib/schema";
import {
  assertSameOrigin,
  errorResponse,
  jsonOk,
  readJsonBody,
} from "@/lib/server/http";
import { generateOverview } from "@/lib/server/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/overview
 *
 * On-demand AI overview for the current book/chapter. This is deliberately
 * separate from /api/analyses: it has no citation contract and is labelled as
 * an approximate historical reconstruction in the UI.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const input = await readJsonBody(request, overviewInputSchema);
    const result = await generateOverview(input);
    return jsonOk(result);
  } catch (error) {
    return errorResponse(error);
  }
}
