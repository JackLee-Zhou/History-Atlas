import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  errorResponse,
  jsonOk,
  readJsonBody,
} from "@/lib/server/http";
import {
  getSettingsView,
  updateSettings,
} from "@/lib/server/store";
import { settingsUpdateSchema } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return jsonOk(await getSettingsView());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const update = await readJsonBody(request, settingsUpdateSchema);
    return jsonOk(await updateSettings(update));
  } catch (error) {
    return errorResponse(error);
  }
}
