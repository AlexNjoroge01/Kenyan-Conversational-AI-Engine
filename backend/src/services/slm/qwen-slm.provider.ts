import { AppError } from "../../utils/errors";
import { callWorker, checkWorkerHealth } from "../worker-http";
import type { SlmInput, SlmProvider, SlmResult } from "./slm.provider";

/** Talks to the Qwen worker: POST /complete {messages,...} -> {content}. */
export class QwenSlmProvider implements SlmProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(input: SlmInput): Promise<SlmResult> {
    const response = await callWorker({
      url: `${this.baseUrl}/complete`,
      timeoutMs: this.timeoutMs,
      label: "language model",
      codes: { unavailable: "SLM_UNAVAILABLE", failed: "SLM_COMPLETION_FAILED" },
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: input.messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          response_format: input.responseFormat,
        }),
      },
    });

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.content !== "string") {
      throw new AppError("SLM_COMPLETION_FAILED", "The language model service returned an invalid response.", 502);
    }
    return { content: body.content };
  }

  isHealthy(): Promise<boolean> {
    return checkWorkerHealth(this.baseUrl);
  }
}
