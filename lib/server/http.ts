import "server-only";

import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export const ERROR_CODES = {
  BAD_REQUEST: "BAD_REQUEST",
  PROVIDER_NOT_CONFIGURED: "PROVIDER_NOT_CONFIGURED",
  PROVIDER_AUTH: "PROVIDER_AUTH",
  PROVIDER_RATE_LIMIT: "PROVIDER_RATE_LIMIT",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  MODEL_BAD_JSON: "MODEL_BAD_JSON",
  TEXT_TOO_LONG: "TEXT_TOO_LONG",
  NO_TEXT_LAYER: "NO_TEXT_LAYER",
  UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
  IMPORT_TOO_LARGE: "IMPORT_TOO_LARGE",
  CHAPTER_NOT_FOUND: "CHAPTER_NOT_FOUND",
  BOOK_NOT_FOUND: "BOOK_NOT_FOUND",
  ANALYSIS_NOT_FOUND: "ANALYSIS_NOT_FOUND",
  ANALYSIS_ABORTED: "ANALYSIS_ABORTED",
  NO_PLACES_FOUND: "NO_PLACES_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? 400;
    this.retryable = options.retryable ?? false;
  }
}

export function jsonError(
  code: ErrorCode,
  message: string,
  status = 400,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return jsonError(error.code, error.message, error.status);
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return jsonError(
      ERROR_CODES.BAD_REQUEST,
      first ? `${first.path.join(".") || "请求"}：${first.message}` : "请求格式不正确",
      400,
    );
  }
  console.error("[api] unhandled error", error);
  return jsonError(ERROR_CODES.INTERNAL, "服务内部错误，请重试", 500);
}

export async function readJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError(ERROR_CODES.BAD_REQUEST, "请求体不是合法 JSON");
  }
  return schema.parse(raw);
}

export function assertSameOrigin(request: Request): void {
  // Browsers send this on cross-site fetches even when they omit Origin in a
  // few edge cases (form posts, redirects).
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError(ERROR_CODES.FORBIDDEN, "跨站请求被拒绝", { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestUrl = new URL(request.url);
  const allowedHosts = new Set<string>([
    requestUrl.host,
    request.headers.get("host") ?? "",
    ...(request.headers.get("x-forwarded-host") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    `localhost:${requestUrl.port || "80"}`,
    `127.0.0.1:${requestUrl.port || "80"}`,
  ]);

  // Docker/reverse proxies often terminate the public port outside the app
  // process: request.url may be internal while Browser Origin is the mapped
  // host. PUBLIC_ORIGIN lets deployments declare the public origin explicitly.
  for (const configured of (process.env.PUBLIC_ORIGIN ?? "").split(",")) {
    const value = configured.trim();
    if (!value) continue;
    try {
      allowedHosts.add(new URL(value).host);
    } catch {
      // ignore malformed PUBLIC_ORIGIN entries
    }
  }

  try {
    const originUrl = new URL(origin);
    if (allowedHosts.has(originUrl.host)) return;
    // Local development and local Docker port mappings are same-machine even
    // when the host port differs from the container port.
    if (
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(originUrl.hostname)
    ) {
      return;
    }
  } catch {
    // fall through
  }
  throw new AppError(ERROR_CODES.FORBIDDEN, "跨站请求被拒绝", { status: 403 });
}

export function asNdjsonResponse(
  stream: ReadableStream<Uint8Array>,
): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
