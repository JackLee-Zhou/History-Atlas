import type {
  LlmClient,
  LlmCompleteArgs,
  LlmStreamArgs,
  LlmTextResult,
} from "./types";

/**
 * Rule mode is implemented by the pipeline, not by an LLM. This client exists
 * so provider selection has a uniform type and never touches the network.
 */
export class RuleLlmClient implements LlmClient {
  readonly name = "rule";
  readonly model = "rule";

  async complete(_args: LlmCompleteArgs): Promise<LlmTextResult> {
    void _args;
    return { raw: "" };
  }

  async stream(_args: LlmStreamArgs): Promise<{ usage?: undefined }> {
    void _args;
    return {};
  }

  async testConnection(_signal?: AbortSignal): Promise<{ latencyMs: number }> {
    void _signal;
    return { latencyMs: 0 };
  }
}

export function createRuleClient(): LlmClient {
  return new RuleLlmClient();
}
