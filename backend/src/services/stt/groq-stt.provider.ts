import {
  cachedHealthCheck,
  callProvider,
  invalidResponse,
  probe,
  readJsonObject,
  type FetchLike,
  type ProviderContext,
} from "../provider-http";
import { toLanguageCode } from "./languages";
import type { SttInput, SttProvider, SttResult } from "./stt.provider";

export interface GroqSttOptions {
  apiKey: string;
  /** Groq model ID, e.g. "whisper-large-v3-turbo". Never exposed to clients. */
  model: string;
  timeoutMs: number;
  baseUrl?: string;
  fetch?: FetchLike;
}

const CTX: ProviderContext = {
  label: "speech-to-text",
  provider: "groq",
  codes: { unavailable: "STT_UNAVAILABLE", failed: "STT_TRANSCRIPTION_FAILED" },
};

/** Groq infers the container from the file extension, so make sure the upload has one it accepts. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "video/mp4": "mp4",
};
const GROQ_EXTENSIONS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);

export function uploadFilename(filename: string, mimeType: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (GROQ_EXTENSIONS.has(ext)) return filename;
  const mime = mimeType.toLowerCase().split(";")[0]!.trim();
  return `audio.${EXTENSION_BY_MIME[mime] ?? "wav"}`;
}

/**
 * Whisper Large V3 Turbo hosted by Groq, via its OpenAI-compatible endpoint:
 * POST {base}/audio/transcriptions (multipart) with response_format=verbose_json so the detected
 * language and duration come back alongside the text.
 */
export class GroqSttProvider implements SttProvider {
  private readonly baseUrl: string;
  private readonly doFetch: FetchLike;
  readonly isHealthy: () => Promise<boolean>;

  constructor(private readonly options: GroqSttOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
    this.isHealthy = cachedHealthCheck(async () =>
      Boolean(await probe(`${this.baseUrl}/models`, { headers: this.authHeaders() }, this.doFetch)),
    );
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.apiKey}` };
  }

  async transcribe(input: SttInput): Promise<SttResult> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
      uploadFilename(input.filename, input.mimeType),
    );
    form.append("model", this.options.model);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (input.language) form.append("language", input.language);

    const response = await callProvider({
      ...CTX,
      url: `${this.baseUrl}/audio/transcriptions`,
      timeoutMs: this.options.timeoutMs,
      fetch: this.doFetch,
      init: { method: "POST", headers: this.authHeaders(), body: form },
    });

    const body = await readJsonObject(response, CTX);
    if (typeof body.text !== "string") throw invalidResponse(CTX);
    const duration = Number(body.duration);
    return {
      text: body.text.trim(),
      language: toLanguageCode(body.language, input.language ?? "und"),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    };
  }
}
