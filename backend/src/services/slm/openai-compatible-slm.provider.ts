import {
  cachedHealthCheck,
  callProvider,
  invalidResponse,
  probe,
  readJsonObject,
  type FetchLike,
  type ProviderContext,
} from "../provider-http";
import type { SlmInput, SlmProvider, SlmResult } from "./slm.provider";
import { stripThinking } from "./thinking";

export type ThinkingControl = "auto" | "reasoning" | "chat_template_kwargs" | "none";

export interface OpenAiCompatibleSlmOptions {
  /** e.g. https://openrouter.ai/api/v1 or https://router.huggingface.co/v1 */
  baseUrl: string;
  apiKey?: string;
  /** The host's model ID, e.g. "qwen/qwen3.5-9b". Never exposed to clients. */
  model: string;
  timeoutMs: number;
  disableThinking?: ThinkingControl;
  fetch?: FetchLike;
}

const CTX: ProviderContext = {
  label: "language model",
  provider: "openai-compatible",
  codes: { unavailable: "SLM_UNAVAILABLE", failed: "SLM_COMPLETION_FAILED" },
};

/** Request fields that ask the host to skip thinking. OpenRouter uses `reasoning`; vLLM/SGLang-based hosts use `chat_template_kwargs`. */
export function thinkingParams(control: ThinkingControl, baseUrl: string): Record<string, unknown> {
  const resolved = control === "auto" ? (new URL(baseUrl).hostname.endsWith("openrouter.ai") ? "reasoning" : "chat_template_kwargs") : control;
  if (resolved === "reasoning") return { reasoning: { enabled: false } };
  if (resolved === "chat_template_kwargs") return { chat_template_kwargs: { enable_thinking: false } };
  return {};
}

/**
 * Fallback SLM for when the GPU worker is offline: any OpenAI-compatible chat completions API
 * (OpenRouter, Hugging Face Inference Providers, a vLLM server...).
 */
export class OpenAiCompatibleSlmProvider implements SlmProvider {
  private readonly baseUrl: string;
  private readonly doFetch: FetchLike;
  readonly isHealthy: () => Promise<boolean>;

  constructor(private readonly options: OpenAiCompatibleSlmOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
    this.isHealthy = cachedHealthCheck(async () =>
      Boolean(await probe(`${this.baseUrl}/models`, { headers: this.authHeaders() }, this.doFetch)),
    );
  }

  private authHeaders(): Record<string, string> {
    return this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {};
  }

  async complete(input: SlmInput): Promise<SlmResult> {
    const response = await callProvider({
      ...CTX,
      url: `${this.baseUrl}/chat/completions`,
      timeoutMs: this.options.timeoutMs,
      fetch: this.doFetch,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify({
          model: this.options.model,
          messages: input.messages,
          stream: false,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxTokens !== undefined ? { max_tokens: input.maxTokens } : {}),
          ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
          ...thinkingParams(this.options.disableThinking ?? "auto", this.baseUrl),
        }),
      },
    });

    const body = await readJsonObject(response, CTX);
    const choices = body.choices;
    const message = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message : undefined;
    if (!message || typeof message.content !== "string") throw invalidResponse(CTX);
    // Reasoning returned in separate fields (message.reasoning, reasoning_content) is ignored.
    const content = stripThinking(message.content);
    if (!content) throw invalidResponse(CTX, "returned an empty response");
    return { content };
  }
}
