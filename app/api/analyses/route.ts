import {
  analysisInputSchema,
  type AnalysisStreamEvent,
} from "@/lib/schema";
import {
  AppError,
  asNdjsonResponse,
  assertSameOrigin,
  errorResponse,
  readJsonBody,
} from "@/lib/server/http";
import { createNdjsonStream } from "@/lib/server/sse";
import { analysisErrorEvent, analyze } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analyses
 * Validates the request, then streams NDJSON stage/partial/result/error
 * events. Cancellation stops at stage boundaries and never persists a partial
 * analysis.
 */
export async function POST(request: Request): Promise<Response> {
  let input;
  try {
    assertSameOrigin(request);
    input = await readJsonBody(request, analysisInputSchema);
  } catch (error) {
    return errorResponse(error);
  }

  const stream = createNdjsonStream<AnalysisStreamEvent>(
    async (emit, streamSignal) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (request.signal.aborted) controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      streamSignal.addEventListener("abort", abort, { once: true });

      try {
        await analyze(input, {
          emit,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!(error instanceof AppError)) {
          console.error("[analyses] unexpected pipeline failure");
        }
        emit(analysisErrorEvent(error));
      } finally {
        request.signal.removeEventListener("abort", abort);
        streamSignal.removeEventListener("abort", abort);
      }
    },
  );

  return asNdjsonResponse(stream);
}
