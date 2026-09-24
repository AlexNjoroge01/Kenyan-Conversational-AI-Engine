import { AppError } from "../../utils/errors";
import { callWorker, checkWorkerHealth } from "../worker-http";
import type { SttInput, SttProvider, SttResult } from "./stt.provider";

/** Talks to the Whisper worker: POST /transcribe (multipart) -> {text, language}. */
export class WhisperSttProvider implements SttProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async transcribe(input: SttInput): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), input.filename);
    if (input.language) form.append("language", input.language);

    const response = await callWorker({
      url: `${this.baseUrl}/transcribe`,
      timeoutMs: this.timeoutMs,
      label: "speech-to-text",
      codes: { unavailable: "STT_UNAVAILABLE", failed: "STT_TRANSCRIPTION_FAILED" },
      init: { method: "POST", body: form },
    });

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.text !== "string" || typeof body.language !== "string") {
      throw new AppError("STT_TRANSCRIPTION_FAILED", "The speech-to-text service returned an invalid response.", 502);
    }
    return { text: body.text, language: body.language };
  }

  isHealthy(): Promise<boolean> {
    return checkWorkerHealth(this.baseUrl);
  }
}
