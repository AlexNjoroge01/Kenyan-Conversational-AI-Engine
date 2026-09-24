import type { TtsInput, TtsProvider, TtsResult } from "./tts.provider";

const SAMPLE_RATE = 16_000;

/**
 * Development/test stand-in for the GPU worker. Produces a short, valid, playable WAV tone whose
 * length scales with the input text. It cannot encode MP3, so it always returns WAV and says so
 * in the content type.
 */
export class MockTtsProvider implements TtsProvider {
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const seconds = Math.min(10, Math.max(0.3, input.text.length * 0.06));
    return { audio: buildWavTone(seconds), contentType: "audio/wav", durationSeconds: seconds };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}

export function buildWavTone(seconds: number, frequency = 440): Buffer {
  const samples = Math.floor(seconds * SAMPLE_RATE);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 400, (samples - i) / 400);
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * 8000 * fade), 44 + i * 2);
  }
  return buffer;
}
