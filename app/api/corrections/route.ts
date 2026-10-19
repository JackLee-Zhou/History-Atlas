import { z } from "zod";
import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  errorResponse,
  jsonOk,
  readJsonBody,
} from "@/lib/server/http";
import {
  addCorrection,
  getAnalysis,
  listCorrections,
  updateAnalysisPlaceLocation,
} from "@/lib/server/store";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import { PRECISION_RADIUS_KM } from "@/lib/constants";

export const runtime = "nodejs";

const correctionInputSchema = z.object({
  ancientName: z.string().min(1).max(100),
  periodLabel: z.string().max(100).optional(),
  bookId: z.string().max(200).optional(),
  modernName: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precision: z.enum(["site", "county", "city"]),
  analysisId: z.string().max(200).optional(),
  placeId: z.string().max(200).optional(),
});

export async function GET(): Promise<NextResponse> {
  try {
    return jsonOk({ corrections: await listCorrections() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const input = await readJsonBody(request, correctionInputSchema);
    const { analysisId, placeId, ...correctionInput } = input;
    if (analysisId && placeId) {
      const analysis = await getAnalysis(analysisId);
      if (!analysis) {
        throw new AppError(ERROR_CODES.ANALYSIS_NOT_FOUND, "分析不存在。", {
          status: 404,
        });
      }
      if (!analysis.situation.places.some((place) => place.id === placeId)) {
        throw new AppError(ERROR_CODES.BAD_REQUEST, "地点不在该分析中。", {
          status: 400,
        });
      }
    }
    const correction = await addCorrection(correctionInput);
    const analysis =
      analysisId && placeId
        ? await updateAnalysisPlaceLocation(analysisId, placeId, {
            lat: input.lat,
            lng: input.lng,
            precision: input.precision,
            confidence: 1,
            radiusKm: PRECISION_RADIUS_KM[input.precision],
          })
        : undefined;
    return jsonOk({ correction, analysis }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
