import {
  cachedHealthCheck,
  callProvider,
  invalidResponse,
  readJsonObject,
  workerHeaders,
  workerModelHealthy,
  type ProviderContext,
  type WorkerProviderOptions,
} from "../provider-http";
import type { SlmInput, SlmProvider, SlmResult } from "./slm.provider";
import { stripThinking } from "./thinking";

const CTX: ProviderContext = {
  label: "language model",
  provider: "gpu-worker",
  codes: { unavailable: "SLM_UNAVAILABLE", failed: "SLM_COMPLETION_FAILED" },
};

/** Talks to the self-hosted Qwen worker: POST /complete {messages,...} -> {content}. */
export class QwenSlmProvider implements SlmProvider {
  private readonly baseUrl: string;
  readonly isHealthy: () => Promise<boolean>;

  constructor(private readonly options: WorkerProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.isHealthy = cachedHealthCheck(() =>
      workerModelHealthy(this.baseUrl, "slm", options.workerApiKey, options.fetch),
    );
  }

  async complete(input: SlmInput): Promise<SlmResult> {
    const response = await callProvider({
      ...CTX,
      url: `${this.baseUrl}/complete`,
      timeoutMs: this.options.timeoutMs,
      fetch: this.options.fetch,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders(this.options.workerApiKey) },
        body: JSON.stringify({
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          response_format: input.responseFormat,
        }),
      },
    });

    const body = await readJsonObject(response, CTX);
    if (typeof body.content !== "string") throw invalidResponse(CTX);
    const content = stripThinking(body.content);
    if (!content) throw invalidResponse(CTX, "returned an empty response");
    return { content };
  }
}
