import type { Provider } from "@/lib/schema/settings";
import type { Usage } from "@/lib/schema/common";

export interface LlmConfig {
  provider: Provider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface LlmCompleteArgs {
  system: string;
  user: string;
  temperature?: number;
  signal?: AbortSignal;
  /** Ask the provider for JSON mode when it supports it. */
  json?: boolean;
}

export interface LlmTextResult {
  raw: string;
  usage?: Usage;
}

export interface LlmStreamArgs {
  system: string;
  user: string;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}

export interface LlmClient {
  readonly name: string;
  readonly model: string;
  complete(args: LlmCompleteArgs): Promise<LlmTextResult>;
  stream(args: LlmStreamArgs): Promise<{ usage?: Usage }>;
  testConnection(signal?: AbortSignal): Promise<{ latencyMs: number }>;
}

export interface LlmFactoryOptions {
  config: LlmConfig;
  fetchImpl?: typeof fetch;
}
