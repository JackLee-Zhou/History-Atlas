import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ERROR_CODES } from "@/lib/server/http";
import { createLlmClient } from "@/lib/llm";
import { createOpenAiClient } from "@/lib/llm/openai";

const FAKE_KEY = "test-key-not-real-1234";
const BASE_URL = "https://llm.example.test/v1";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function makeFetchMock(): {
  fetchMock: ReturnType<typeof vi.fn<FetchFn>>;
  fetchImpl: typeof fetch;
} {
  const fetchMock = vi.fn<FetchFn>();
  return {
    fetchMock,
    fetchImpl: fetchMock as unknown as typeof fetch,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chatResponse(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number },
): Response {
  return jsonResponse({
    choices: [{ message: { role: "assistant", content } }],
    ...(usage ? { usage } : {}),
  });
}

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${event}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<FetchFn>>, call: number) {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

const retry = { minTimeout: 0, maxTimeout: 0, factor: 1 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenAI-compatible LLM client", () => {
  it("sends a JSON-mode chat request and parses content + usage", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockResolvedValueOnce(
      chatResponse('{"ok":true}', { prompt_tokens: 5, completion_tokens: 3 }),
    );
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: `${BASE_URL}/`,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    const result = await client.complete({
      system: "system prompt",
      user: "user prompt",
      json: true,
      temperature: 0.1,
    });

    expect(result.raw).toBe('{"ok":true}');
    expect(result.usage).toEqual({ input: 5, output: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/chat/completions`,
    );
    const body = requestBody(fetchMock, 0);
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.1);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("retries once without response_format when a provider rejects JSON mode", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock
      .mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
      .mockResolvedValueOnce(chatResponse('{"ok":true}'));
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    const result = await client.complete({
      system: "s",
      user: "u",
      json: true,
    });

    expect(result.raw).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).response_format).toEqual({
      type: "json_object",
    });
    expect(requestBody(fetchMock, 1)).not.toHaveProperty("response_format");
  });

  it("maps 401 to PROVIDER_AUTH without retrying and never logs the key", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );
    const logs: string[] = [];
    const capture = (...args: unknown[]) => {
      logs.push(args.map((value) => String(value)).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);

    let caught: unknown;
    try {
      await client.complete({ system: "s", user: "u" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: ERROR_CODES.PROVIDER_AUTH });
    expect((caught as Error).message).not.toContain(FAKE_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.some((line) => line.includes(FAKE_KEY))).toBe(false);
  });

  it("retries 429 twice and surfaces PROVIDER_RATE_LIMIT", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockResolvedValue(new Response("limited", { status: 429 }));
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    await expect(
      client.complete({ system: "s", user: "u" }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_RATE_LIMIT,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps exhausted 5xx retries to a retryable internal provider error", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockResolvedValue(new Response("oops", { status: 503 }));
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    await expect(
      client.complete({ system: "s", user: "u" }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.INTERNAL,
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("maps AbortError to PROVIDER_TIMEOUT", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    await expect(
      client.complete({ system: "s", user: "u" }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PROVIDER_TIMEOUT });
  });

  it("streams SSE deltas and returns usage", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        '{"choices":[{"delta":{"content":"曹"}}]}',
        '{"choices":[{"delta":{"content":"操"}}]}',
        '{"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}',
        "[DONE]",
      ]),
    );
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    const deltas: string[] = [];
    const result = await client.stream({
      system: "s",
      user: "u",
      onDelta: (text) => deltas.push(text),
    });

    expect(deltas.join("")).toBe("曹操");
    expect(result.usage).toEqual({ input: 2, output: 3 });
    expect(requestBody(fetchMock, 0).stream).toBe(true);
  });

  it("reports latency for testConnection", async () => {
    const { fetchMock, fetchImpl } = makeFetchMock();
    fetchMock.mockResolvedValueOnce(chatResponse("OK"));
    const client = createOpenAiClient(
      {
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
        apiKey: FAKE_KEY,
      },
      { fetchImpl, retry },
    );

    const result = await client.testConnection();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the right client through the factory (config and options overloads)", () => {
    expect(createLlmClient({ provider: "rule" }).name).toBe("rule");
    expect(
      createLlmClient({ provider: "mock", model: "demo-model" }).name,
    ).toBe("mock");
    expect(
      createLlmClient(
        {
          provider: "openai",
          baseUrl: BASE_URL,
          model: "test-model",
          apiKey: FAKE_KEY,
        },
        { fetchImpl: makeFetchMock().fetchImpl },
      ).name,
    ).toBe("openai");
    expect(
      createLlmClient({
        config: {
          provider: "ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "qwen2.5:7b",
        },
        fetchImpl: makeFetchMock().fetchImpl,
      }).name,
    ).toBe("ollama");
  });

  it("requires baseUrl/model and an OpenAI key, but allows Ollama without a key", () => {
    expect(() =>
      createOpenAiClient({
        provider: "openai",
        baseUrl: BASE_URL,
        model: "test-model",
      }),
    ).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.PROVIDER_NOT_CONFIGURED }),
    );

    expect(() =>
      createOpenAiClient({ provider: "openai", model: "test-model", apiKey: FAKE_KEY }),
    ).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.PROVIDER_NOT_CONFIGURED }),
    );

    const ollama = createOpenAiClient({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
    });
    expect(ollama.name).toBe("ollama");
    expect(ollama.model).toBe("qwen2.5:7b");
  });
});
