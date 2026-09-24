import type { TtsFormat } from "../../config/constants";

export interface TtsInput {
  text: string;
  voice: string;
  format: TtsFormat;
}

export interface TtsResult {
  audio: Buffer;
  contentType: string;
  durationSeconds?: number;
}

export interface TtsProvider {
  synthesize(input: TtsInput): Promise<TtsResult>;
  isHealthy(): Promise<boolean>;
}
