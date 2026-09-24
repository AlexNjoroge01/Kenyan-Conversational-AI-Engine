import { randomUUID } from "node:crypto";
import { MODELS } from "../../config/constants";
import type { ChatRequest } from "../../schemas/chat.schema";
import { AppError, modelNotFound } from "../../utils/errors";
import type { SlmProvider } from "./slm.provider";

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: { index: number; message: { role: "assistant"; content: string }; finish_reason: "stop" }[];
}

export class SlmService {
  constructor(private readonly provider: SlmProvider) {}

  async complete(request: ChatRequest): Promise<ChatCompletion & { latencyMs: number }> {
    if (request.model !== MODELS.slm) throw modelNotFound(request.model);
    if (request.stream) {
      throw new AppError("NOT_IMPLEMENTED", "Streaming chat completions are not yet supported. Set stream to false.", 501);
    }

    const responseFormat = request.response_format?.type;
    const started = performance.now();
    const { content } = await this.provider.complete({
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.max_tokens,
      responseFormat,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (responseFormat === "json_object") {
      try {
        JSON.parse(content);
      } catch {
        throw new AppError("SLM_COMPLETION_FAILED", "The language model did not return valid JSON.", 502);
      }
    }

    return {
      id: `chat_${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: MODELS.slm,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      latencyMs,
    };
  }

  isHealthy(): Promise<boolean> {
    return this.provider.isHealthy();
  }
}
