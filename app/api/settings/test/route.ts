import { NextResponse } from "next/server";
import {
  AppError,
  assertSameOrigin,
  errorResponse,
  jsonOk,
  readJsonBody,
} from "@/lib/server/http";
import { getEffectiveSettings } from "@/lib/server/store";
import { settingsTestInputSchema, type SettingsTestResult } from "@/lib/schema";
import { OpenAiCompatibleClient } from "@/lib/llm/openai";
import { normalizeLlmBaseUrl } from "@/lib/llm/url";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const input = await readJsonBody(request, settingsTestInputSchema);

    if (input.provider === "rule" || input.provider === "mock") {
      return jsonOk<SettingsTestResult>({
        ok: true,
        message:
          input.provider === "rule"
            ? "规则模式无需连接模型；可识别地名并标注原文。"
            : "演示模式无需连接模型。",
      });
    }

    const stored = await getEffectiveSettings();
    const providedBaseUrl = input.baseUrl?.trim()
      ? await normalizeLlmBaseUrl(input.baseUrl, input.provider)
      : undefined;
    const storedBaseUrl = await normalizeLlmBaseUrl(
      stored.baseUrl,
      input.provider,
    );
    const baseUrl = providedBaseUrl || storedBaseUrl;
    const apiKey = input.apiKey?.trim() || stored.apiKey;
    const model = input.model?.trim() || stored.model;

    // A key belongs to the endpoint that was configured with it. Never send
    // the stored key to a different endpoint just because a test request
    // supplied another Base URL.
    if (
      providedBaseUrl &&
      providedBaseUrl !== storedBaseUrl &&
      !input.apiKey?.trim()
    ) {
      return jsonOk<SettingsTestResult>({
        ok: false,
        message: "更换 Base URL 后需要重新填写 API Key，旧 Key 不会发送到新地址。",
      });
    }

    if (input.provider === "openai" && !apiKey) {
      return jsonOk<SettingsTestResult>({
        ok: false,
        message: "还没有填写 API Key。",
      });
    }
    if (!baseUrl || !model) {
      return jsonOk<SettingsTestResult>({
        ok: false,
        message: "请先填写 Base URL 与模型名称。",
      });
    }

    const client = new OpenAiCompatibleClient({
      provider: input.provider,
      baseUrl,
      model,
      apiKey,
    });

    try {
      const { latencyMs } = await client.testConnection(
        AbortSignal.timeout(20_000),
      );
      return jsonOk<SettingsTestResult>({
        ok: true,
        message: "连接成功，模型已响应。",
        latencyMs,
        model,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return jsonOk<SettingsTestResult>({
          ok: false,
          message: error.message,
        });
      }
      return jsonOk<SettingsTestResult>({
        ok: false,
        message: "连接失败，请检查 Base URL、模型名与网络。",
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
