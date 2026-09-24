import { TTS_CONTENT_TYPES } from "../../config/constants";
import { AppError } from "../../utils/errors";
import { callWorker, checkWorkerHealth } from "../worker-http";
import type { TtsInput, TtsProvider, TtsResult } from "./tts.provider";

/** Talks to the Sauti V2 worker: POST /synthesize {text, voice, format} -> audio bytes. */
export class SautiTtsProvider implements TtsProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const response = await callWorker({
      url: `${this.baseUrl}/synthesize`,
      timeoutMs: this.timeoutMs,
      label: "text-to-speech",
      codes: { unavailable: "TTS_UNAVAILABLE", failed: "TTS_GENERATION_FAILED" },
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.text, voice: input.voice, format: input.format }),
      },
    });

    let audio: Buffer;
    try {
      audio = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new AppError("TTS_UNAVAILABLE", "The text-to-speech service is currently unavailable.", 503);
    }
    if (audio.length === 0) {
      throw new AppError("TTS_GENERATION_FAILED", "The text-to-speech service returned empty audio.", 502);
    }

    const duration = Number(response.headers.get("x-audio-duration-seconds"));
    return {
      audio,
      contentType: response.headers.get("content-type") ?? TTS_CONTENT_TYPES[input.format],
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    };
  }

  isHealthy(): Promise<boolean> {
    return checkWorkerHealth(this.baseUrl);
  }
}
