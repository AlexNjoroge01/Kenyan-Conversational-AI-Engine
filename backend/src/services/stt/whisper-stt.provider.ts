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
import type { SttInput, SttProvider, SttResult } from "./stt.provider";

const CTX: ProviderContext = {
  label: "speech-to-text",
  provider: "gpu-worker",
  codes: { unavailable: "STT_UNAVAILABLE", failed: "STT_TRANSCRIPTION_FAILED" },
};

/** Talks to a self-hosted Whisper worker: POST /transcribe (multipart) -> {text, language}. */
export class WhisperSttProvider implements SttProvider {
  private readonly baseUrl: string;
  readonly isHealthy: () => Promise<boolean>;

  constructor(private readonly options: WorkerProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.isHealthy = cachedHealthCheck(() =>
      workerModelHealthy(this.baseUrl, "stt", options.workerApiKey, options.fetch),
    );
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), input.filename);
    if (input.language) form.append("language", input.language);

    const response = await callProvider({
      ...CTX,
      url: `${this.baseUrl}/transcribe`,
      timeoutMs: this.options.timeoutMs,
      fetch: this.options.fetch,
      init: { method: "POST", headers: workerHeaders(this.options.workerApiKey), body: form },
    });

    const body = await readJsonObject(response, CTX);
    if (typeof body.text !== "string" || typeof body.language !== "string") throw invalidResponse(CTX);
    return { text: body.text, language: body.language };
  }
}
