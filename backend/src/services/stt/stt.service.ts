import { MODELS } from "../../config/constants";
import type { TranscriptionRequest } from "../../schemas/transcription.schema";
import { modelNotFound } from "../../utils/errors";
import type { SttProvider, SttResult } from "./stt.provider";

export interface AudioFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export class SttService {
  constructor(private readonly provider: SttProvider) {}

  async transcribe(
    request: TranscriptionRequest,
    file: AudioFile,
  ): Promise<SttResult & { model: string; latencyMs: number }> {
    if (request.model !== MODELS.stt) throw modelNotFound(request.model);

    const started = performance.now();
    const result = await this.provider.transcribe({
      audio: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      language: request.language,
    });
    return { ...result, model: MODELS.stt, latencyMs: Math.round(performance.now() - started) };
  }

  isHealthy(): Promise<boolean> {
    return this.provider.isHealthy();
  }
}
