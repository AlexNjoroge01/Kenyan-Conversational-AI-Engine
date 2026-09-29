import { TTS_CONTENT_TYPES } from "../../config/constants";
import {
  cachedHealthCheck,
  callProvider,
  invalidResponse,
  readBytes,
  workerHeaders,
  workerModelHealthy,
  type ProviderContext,
  type WorkerProviderOptions,
} from "../provider-http";
import type { TtsInput, TtsProvider, TtsResult } from "./tts.provider";

const CTX: ProviderContext = {
  label: "text-to-speech",
  provider: "gpu-worker",
  codes: { unavailable: "TTS_UNAVAILABLE", failed: "TTS_GENERATION_FAILED" },
};

/** Talks to the Sauti V2 worker: POST /synthesize {text, voice, format} -> audio bytes. */
export class SautiTtsProvider implements TtsProvider {
  private readonly baseUrl: string;
  readonly isHealthy: () => Promise<boolean>;

  constructor(private readonly options: WorkerProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.isHealthy = cachedHealthCheck(() =>
      workerModelHealthy(this.baseUrl, "tts", options.workerApiKey, options.fetch),
    );
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const response = await callProvider({
      ...CTX,
      url: `${this.baseUrl}/synthesize`,
      timeoutMs: this.options.timeoutMs,
      fetch: this.options.fetch,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", ...workerHeaders(this.options.workerApiKey) },
        body: JSON.stringify({ text: input.text, voice: input.voice, format: input.format }),
      },
    });

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? TTS_CONTENT_TYPES[input.format];
    if (!contentType.startsWith("audio/")) {
      // e.g. an HTML interstitial or JSON from something other than the worker.
      await response.body?.cancel().catch(() => undefined);
      throw invalidResponse(CTX);
    }

    const audio = await readBytes(response, CTX);
    if (audio.length === 0) throw invalidResponse(CTX, "returned empty audio");

    const duration = Number(response.headers.get("x-audio-duration-seconds"));
    return {
      audio,
      contentType,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    };
  }
}
