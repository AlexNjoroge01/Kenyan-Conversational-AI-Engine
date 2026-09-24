export interface SttInput {
  audio: Buffer;
  filename: string;
  mimeType: string;
  language?: string;
}

export interface SttResult {
  text: string;
  language: string;
}

export interface SttProvider {
  transcribe(input: SttInput): Promise<SttResult>;
  isHealthy(): Promise<boolean>;
}
