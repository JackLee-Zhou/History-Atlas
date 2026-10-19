import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  errorResponse,
  jsonOk,
} from "@/lib/server/http";
import { clearApiKey } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    return jsonOk(await clearApiKey());
  } catch (error) {
    return errorResponse(error);
  }
}
