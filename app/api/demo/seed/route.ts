import { NextResponse } from "next/server";
import { assertSameOrigin, errorResponse } from "@/lib/server/http";
import { seedDemo } from "@/lib/server/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const { book, analysis } = await seedDemo();
    return NextResponse.json({ book, analysis });
  } catch (error) {
    return errorResponse(error);
  }
}
