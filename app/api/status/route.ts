import { NextResponse } from "next/server";
import packageJson from "@/package.json";
import { getSettingsView, getStoreCounts } from "@/lib/server/store";
import { errorResponse, jsonOk } from "@/lib/server/http";
import { APP_NAME, PROMPT_VERSION } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const [settings, counts] = await Promise.all([
      getSettingsView(),
      getStoreCounts(),
    ]);
    return jsonOk({
      app: APP_NAME,
      version: packageJson.version,
      promptVersion: PROMPT_VERSION,
      settings,
      counts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
