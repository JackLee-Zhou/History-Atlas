import pRetry from "p-retry";
import { LLM_MAX_RETRIES, LLM_TEMPERATURE, LLM_TIMEOUT_MS } from "@/lib/constants";
import { AppError, ERROR_CODES } from "@/lib/server/http";
import type { Usage } from "@/lib/schema/common";
import type {
  LlmClient,
  LlmCompleteArgs,
  LlmConfig,
  LlmStreamArgs,
  LlmTextResult,
} from "./types";

export interface OpenAiClientOptions {
  fetchImpl?: typeof fetch;
  /**
   * Retry tuning. Tests set zero delays; production uses the defaults from
   * `lib/constants.ts` (2 retries). Retries only apply to 429/5xx responses.
   */
  retry?: {
    retries?: number;
    minTimeout?: number;
    maxTimeout?: number;
    factor?: number;
  };
  /** Request timeout in milliseconds; defaults to LLM_TIMEOUT_MS (90s). */
  timeoutMs?: number;
  /** Default temperature when a call does not specify one. */
  temperature?: number;
}

type AppErrorWithStatus = AppError & { upstreamStatus?: number };

/** 4xx statuses that usually mean "response_format is not supported". */
const JSON_MODE_FALLBACK_STATUSES = new Set([400, 404, 415, 422, 501]);

function withUpstreamStatus(error: AppError, status: number): AppError {
  (error as AppErrorWithStatus).upstreamStatus = status;
  return error;
}

function isAbortLike(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

function asUsage(value: unknown): Usage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const input = raw.prompt_tokens ?? raw.input_tokens ?? raw.prompt_eval_count;
  const output = raw.completion_tokens ?? raw.output_tokens ?? raw.eval_count;
  if (typeof input !== "number" && typeof output !== "number") return undefined;
  return {
    input: Math.max(0, Math.round(typeof input === "number" ? input : 0)),
    output: Math.max(0, Math.round(typeof output === "number" ? output : 0)),
  };
}

function extractContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as {
    message?: { content?: unknown };
    delta?: { content?: unknown };
    text?: unknown;
  };
  const content = first.message?.content ?? first.delta?.content ?? first.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
    return joined.length > 0 ? joined : null;
  }
  return null;
}

function extractUsage(payload: unknown): Usage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  return asUsage((payload as { usage?: unknown }).usage);
}

function normalizeEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

/**
 * Client for any OpenAI-compatible chat-completions endpoint (OpenAI,
 * DeepSeek, Ollama's /v1 compatibility layer, ...).
 *
 * Security notes:
 * - The API key only ever appears in the `Authorization` header.
 * - Error messages never interpolate the key, the messages, or upstream
 *   response bodies, so they are safe to surface and log.
 */
export class OpenAiCompatibleClient implements LlmClient {
  readonly name: string;
  readonly model: string;

  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly defaultTemperature: number;
  private readonly retry: {
    retries: number;
    minTimeout: number;
    maxTimeout: number;
    factor: number;
  };

  constructor(config: LlmConfig, options: OpenAiClientOptions = {}) {
    const baseUrl = config.baseUrl?.trim();
    const model = config.model?.trim();
    const apiKey = config.apiKey?.trim();

    if (!baseUrl || !model) {
      throw new AppError(
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        "尚未配置模型服务：请先在设置页填写 Base URL 与模型名称。",
        { status: 400 },
      );
    }
    if (config.provider === "openai" && !apiKey) {
      throw new AppError(
        ERROR_CODES.PROVIDER_NOT_CONFIGURED,
        "尚未配置 API Key：请先在设置页填写模型 API Key。",
        { status: 400 },
      );
    }

    this.name = config.provider;
    this.model = model;
    this.endpoint = normalizeEndpoint(baseUrl);
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? LLM_TIMEOUT_MS;
    this.defaultTemperature = options.temperature ?? LLM_TEMPERATURE;
    this.retry = {
      retries: options.retry?.retries ?? LLM_MAX_RETRIES,
      minTimeout: options.retry?.minTimeout ?? 400,
      maxTimeout: options.retry?.maxTimeout ?? 3_000,
      factor: options.retry?.factor ?? 2,
    };
  }

  async complete(args: LlmCompleteArgs): Promise<LlmTextResult> {
    if (args.json) {
      try {
        return await this.completeAttempt(args, true);
      } catch (error) {
        const status = (error as AppErrorWithStatus)?.upstreamStatus;
        if (typeof status === "number" && JSON_MODE_FALLBACK_STATUSES.has(status)) {
          // Some compatible servers reject response_format. Retry once
          // without JSON mode instead of failing the whole analysis.
          return this.completeAttempt(args, false);
        }
        throw error;
      }
    }
    return this.completeAttempt(args, false);
  }

  async stream(args: LlmStreamArgs): Promise<{ usage?: Usage }> {
    return this.withTimeout(args.signal, async (signal) => {
      const response = await this.requestWithRetry(args, {
        jsonMode: false,
        stream: true,
        signal,
      });
      const body = response.body;
      if (!body) {
        throw new AppError(ERROR_CODES.INTERNAL, "模型服务没有返回数据流。", {
          status: 502,
          retryable: true,
        });
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let usage: Usage | undefined;
      let done = false;

      try {
        while (!done) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, "").trim();
            buffer = buffer.slice(newline + 1);
            if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (data === "[DONE]") {
                done = true;
                break;
              }
              if (data) {
                try {
                  const payload: unknown = JSON.parse(data);
                  usage = extractUsage(payload) ?? usage;
                  const delta = extractContent(payload);
                  if (typeof delta === "string" && delta.length > 0) {
                    args.onDelta(delta);
                  }
                } catch {
                  // Ignore keep-alive / non-JSON SSE payloads.
                }
              }
            }
            newline = buffer.indexOf("\n");
          }
        }
        if (!done) {
          const rest = buffer.trim();
          if (rest.startsWith("data:")) {
            const data = rest.slice(5).trim();
            if (data && data !== "[DONE]") {
              try {
                const payload: unknown = JSON.parse(data);
                usage = extractUsage(payload) ?? usage;
                const delta = extractContent(payload);
                if (typeof delta === "string" && delta.length > 0) {
                  args.onDelta(delta);
                }
              } catch {
                // ignore
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return { usage };
    });
  }

  async testConnection(signal?: AbortSignal): Promise<{ latencyMs: number }> {
    const startedAt = Date.now();
    await this.complete({
      system: "You are a connectivity test. Reply with a single short word.",
      user: "OK",
      temperature: 0,
      signal,
    });
    return { latencyMs: Math.max(0, Date.now() - startedAt) };
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                           */
  /* ------------------------------------------------------------------ */

  private async completeAttempt(
    args: LlmCompleteArgs,
    jsonMode: boolean,
  ): Promise<LlmTextResult> {
    return this.withTimeout(args.signal, async (signal) => {
      const response = await this.requestWithRetry(args, {
        jsonMode,
        stream: false,
        signal,
      });

      let payload: unknown;
      try {
        payload = (await response.json()) as unknown;
      } catch {
        throw new AppError(
          ERROR_CODES.INTERNAL,
          "模型服务返回了无法解析的响应。",
          { status: 502, retryable: true },
        );
      }

      const content = extractContent(payload);
      if (content === null || content.trim() === "") {
        throw new AppError(
          ERROR_CODES.MODEL_BAD_JSON,
          "模型没有返回有效内容，请重试或更换模型。",
          { status: 502, retryable: true },
        );
      }

      return { raw: content, usage: extractUsage(payload) };
    });
  }

  private async requestWithRetry(
    args: LlmCompleteArgs,
    options: { jsonMode: boolean; stream: boolean; signal: AbortSignal },
  ): Promise<Response> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      temperature:
        typeof args.temperature === "number"
          ? args.temperature
          : this.defaultTemperature,
      stream: options.stream,
    };
    if (options.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: options.stream ? "text/event-stream" : "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return pRetry(
      async () => {
        let response: Response;
        try {
          response = await this.fetchImpl(this.endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: options.signal,
          });
        } catch (error) {
          if (options.signal.aborted || isAbortLike(error)) throw error;
          throw new AppError(
            ERROR_CODES.INTERNAL,
            "无法连接模型服务，请检查 Base URL 与网络设置。",
            { status: 502, retryable: true, cause: error },
          );
        }
        if (!response.ok) {
          throw this.errorForStatus(response.status);
        }
        return response;
      },
      {
        retries: this.retry.retries,
        minTimeout: this.retry.minTimeout,
        maxTimeout: this.retry.maxTimeout,
        factor: this.retry.factor,
        shouldRetry: ({ error }) =>
          !options.signal.aborted &&
          error instanceof AppError &&
          error.retryable === true,
      },
    );
  }

  private async withTimeout<T>(
    externalSignal: AbortSignal | undefined,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", onAbort, { once: true });
    }

    try {
      return await task(controller.signal);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isAbortLike(error)) {
        throw new AppError(
          ERROR_CODES.PROVIDER_TIMEOUT,
          `模型请求超时（${Math.round(this.timeoutMs / 1000)} 秒），请检查网络或稍后重试。`,
          { status: 504, retryable: true, cause: error },
        );
      }
      throw new AppError(
        ERROR_CODES.INTERNAL,
        "模型调用失败，请稍后重试。",
        { status: 502, retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  private errorForStatus(status: number): AppError {
    if (status === 401 || status === 403) {
      return withUpstreamStatus(
        new AppError(
          ERROR_CODES.PROVIDER_AUTH,
          "模型服务认证失败，请检查 API Key 与 Base URL 是否正确。",
          { status, retryable: false },
        ),
        status,
      );
    }
    if (status === 429) {
      return withUpstreamStatus(
        new AppError(
          ERROR_CODES.PROVIDER_RATE_LIMIT,
          "模型服务限流（HTTP 429），请稍后重试。",
          { status: 429, retryable: true },
        ),
        status,
      );
    }
    if (status >= 500) {
      return withUpstreamStatus(
        new AppError(
          ERROR_CODES.INTERNAL,
          `模型服务暂时不可用（HTTP ${status}），请稍后重试。`,
          { status: 502, retryable: true },
        ),
        status,
      );
    }
    return withUpstreamStatus(
      new AppError(
        ERROR_CODES.BAD_REQUEST,
        `模型服务拒绝了请求（HTTP ${status}），请检查模型名称与配置。`,
        { status: 502, retryable: false },
      ),
      status,
    );
  }
}

export function createOpenAiClient(
  config: LlmConfig,
  options: OpenAiClientOptions = {},
): LlmClient {
  return new OpenAiCompatibleClient(config, options);
}
