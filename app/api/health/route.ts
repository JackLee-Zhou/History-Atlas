import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight container health probe; no library scan or secret material. */
export async function GET(): Promise<NextResponse> {
  try {
    await pingDatabase();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
