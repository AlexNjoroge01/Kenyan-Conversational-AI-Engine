import { MODELS } from "../../config/constants";
import type { SpeechRequest } from "../../schemas/speech.schema";
import { AppError, modelNotFound } from "../../utils/errors";
import type { TtsProvider, TtsResult } from "./tts.provider";

export class TtsService {
  constructor(private readonly provider: TtsProvider) {}

  async synthesize(request: SpeechRequest): Promise<TtsResult & { latencyMs: number }> {
    if (request.model !== MODELS.tts) throw modelNotFound(request.model);
    if (request.stream) {
      throw new AppError("NOT_IMPLEMENTED", "Streaming speech generation is not yet supported. Set stream to false.", 501);
    }

    const started = performance.now();
    const result = await this.provider.synthesize({
      text: request.input.trim(),
      voice: request.voice,
      format: request.response_format,
    });
    return { ...result, latencyMs: Math.round(performance.now() - started) };
  }

  isHealthy(): Promise<boolean> {
    return this.provider.isHealthy();
  }
}
