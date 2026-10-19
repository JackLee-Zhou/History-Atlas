import "server-only";

/**
 * Small NDJSON writer used by the analysis route.
 * The client reads the body with fetch + TextDecoder; EventSource is not used.
 */
export function createNdjsonStream<T>(
  run: (emit: (event: T) => void, signal: AbortSignal) => Promise<void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: T) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await run(emit, abortController.signal);
        controller.close();
      } catch (error) {
        if (!abortController.signal.aborted) {
          const message =
            error instanceof Error ? error.message : "未知错误";
          emit({
            type: "error",
            code: "INTERNAL",
            message,
            retryable: false,
          } as unknown as T);
        }
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });
}
