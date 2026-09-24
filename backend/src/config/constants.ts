/** Public model IDs. Never expose the underlying Hugging Face identifiers. */
export const MODELS = {
  stt: "whisper-large-v3-turbo",
  slm: "qwen3.5-4b",
  tts: "sauti-v2",
} as const;

export const TTS_FORMATS = ["mp3", "wav"] as const;
export type TtsFormat = (typeof TTS_FORMATS)[number];

export const TTS_CONTENT_TYPES: Record<TtsFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

export const TTS_VOICES = ["default"] as const;

export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-flac",
  "video/webm",
  "video/mp4",
] as const;

export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;
export const API_KEY_RANDOM_BYTES = 32;

export const REQUEST_ID_HEADER = "X-Request-ID";
