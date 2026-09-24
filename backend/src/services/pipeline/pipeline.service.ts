import { MODELS, type TtsFormat } from "../../config/constants";
import type { SlmMessage } from "../slm/slm.provider";
import type { SlmService } from "../slm/slm.service";
import type { AudioFile, SttService } from "../stt/stt.service";
import type { TtsService } from "../tts/tts.service";

export interface VoiceTurnInput {
  audio: AudioFile;
  language?: string;
  /** Prior conversation turns, oldest first. */
  history?: SlmMessage[];
  systemPrompt?: string;
  voice?: string;
  format?: TtsFormat;
}

export interface VoiceTurnResult {
  transcript: string;
  language: string;
  reply: string;
  audio: Buffer;
  contentType: string;
  audioDurationSeconds?: number;
  timingsMs: { stt: number; slm: number; tts: number; total: number };
}

/**
 * Synchronous voice loop: audio -> STT -> SLM -> TTS -> audio.
 * Internal only (no public route in the MVP). Each stage is its own service so it stays independently testable.
 */
export class PipelineService {
  constructor(
    private readonly stt: SttService,
    private readonly slm: SlmService,
    private readonly tts: TtsService,
  ) {}

  async runVoiceTurn(input: VoiceTurnInput): Promise<VoiceTurnResult> {
    const started = performance.now();

    const transcription = await this.stt.transcribe({ model: MODELS.stt, language: input.language }, input.audio);

    const messages: SlmMessage[] = [
      ...(input.systemPrompt ? [{ role: "system" as const, content: input.systemPrompt }] : []),
      ...(input.history ?? []),
      { role: "user", content: transcription.text },
    ];
    const completion = await this.slm.complete({ model: MODELS.slm, messages, stream: false });
    const reply = completion.choices[0]!.message.content;

    const speech = await this.tts.synthesize({
      model: MODELS.tts,
      input: reply,
      voice: (input.voice ?? "default") as "default",
      response_format: input.format ?? "mp3",
      stream: false,
    });

    return {
      transcript: transcription.text,
      language: transcription.language,
      reply,
      audio: speech.audio,
      contentType: speech.contentType,
      audioDurationSeconds: speech.durationSeconds,
      timingsMs: {
        stt: transcription.latencyMs,
        slm: completion.latencyMs,
        tts: speech.latencyMs,
        total: Math.round(performance.now() - started),
      },
    };
  }
}
