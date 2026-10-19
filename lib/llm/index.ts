import "server-only";

import type { LlmClient, LlmConfig, LlmFactoryOptions } from "./types";
import { createMockClient } from "./mock";
import { createOpenAiClient, type OpenAiClientOptions } from "./openai";
import { createRuleClient } from "./rule";

export type CreateLlmClientOptions = LlmFactoryOptions & OpenAiClientOptions;

function isFactoryOptions(
  value: LlmConfig | CreateLlmClientOptions,
): value is CreateLlmClientOptions {
  return (
    typeof (value as { config?: unknown }).config === "object" &&
    (value as { config?: unknown }).config !== null
  );
}

/**
 * Build an LLM client for the configured provider.
 *
 * Callers must handle the "no key" case before calling this factory: the
 * pipeline deliberately falls back to rule mode when an OpenAI provider has no
 * key. Direct calls with an incomplete config throw PROVIDER_NOT_CONFIGURED so
 * the settings UI can tell the user what to fill in.
 */
export function createLlmClient(
  config: LlmConfig,
  options?: OpenAiClientOptions,
): LlmClient;
export function createLlmClient(options: LlmFactoryOptions): LlmClient;
export function createLlmClient(
  configOrOptions: LlmConfig | CreateLlmClientOptions,
  maybeOptions: OpenAiClientOptions = {},
): LlmClient {
  const factoryOptions = isFactoryOptions(configOrOptions);
  const config: LlmConfig = factoryOptions
    ? configOrOptions.config
    : (configOrOptions as LlmConfig);
  const options = factoryOptions ? configOrOptions : maybeOptions;

  switch (config.provider) {
    case "rule":
      return createRuleClient();
    case "mock":
      return createMockClient(config.model?.trim() || "mock");
    case "openai":
    case "ollama":
      return createOpenAiClient(config, options);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`unknown provider: ${String(exhaustive)}`);
    }
  }
}

export { createMockClient } from "./mock";
export { createOpenAiClient } from "./openai";
export type { OpenAiClientOptions } from "./openai";
export { createRuleClient } from "./rule";
export { parseJsonLoose, parseJsonOrNull, sliceBracedObject, stripCodeFence } from "./json";
export type {
  LlmClient,
  LlmCompleteArgs,
  LlmConfig,
  LlmFactoryOptions,
  LlmStreamArgs,
  LlmTextResult,
} from "./types";
