import { TTS_CONTENT_TYPES } from "../config/constants";
import type { SpeechRequest } from "../schemas/speech.schema";
import type { TtsService } from "./tts/tts.service";

export interface SpeechOutput {
  audio: Buffer;
  contentType: string;
  filename: string;
  durationSeconds?: number;
  latencyMs: number;
}

export class SpeechService {
  constructor(private readonly tts: TtsService) {}

  async createSpeech(request: SpeechRequest): Promise<SpeechOutput> {
    const result = await this.tts.synthesize(request);
    // Trust the worker's content type: it may legitimately differ (e.g. a mock that only emits WAV).
    const contentType = result.contentType || TTS_CONTENT_TYPES[request.response_format];
    const extension = contentType.includes("wav") ? "wav" : "mp3";
    return {
      audio: result.audio,
      contentType,
      filename: `speech.${extension}`,
      durationSeconds: result.durationSeconds,
      latencyMs: result.latencyMs,
    };
  }
}
