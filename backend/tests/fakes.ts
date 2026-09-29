// Test-only doubles. The application has no mock mode; these exist so the HTTP, auth, validation and
// usage-logging tests run without spending Groq quota or needing the Kaggle GPU worker online.
// The real provider classes are tested separately against a mocked fetch (providers.test.ts).
import type { Providers } from "../src/services/container";
import type { SlmInput, SlmProvider, SlmResult } from "../src/services/slm/slm.provider";
import type { SttInput, SttProvider, SttResult } from "../src/services/stt/stt.provider";
import type { TtsInput, TtsProvider, TtsResult } from "../src/services/tts/tts.provider";

const SAMPLE_RATE = 16_000;

/** A short, valid, playable 16-bit mono WAV (sine tone) for upload fixtures and fake TTS output. */
export function buildWav(seconds: number, frequency = 440): Buffer {
  const samples = Math.floor(seconds * SAMPLE_RATE);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE) * 8000), 44 + i * 2);
  }
  return buffer;
}

export class FakeStt implements SttProvider {
  async transcribe(input: SttInput): Promise<SttResult> {
    return { text: "Nataka kujua status ya order yangu.", language: input.language ?? "sw" };
  }
  async isHealthy() {
    return true;
  }
}

export class FakeSlm implements SlmProvider {
  async complete(input: SlmInput): Promise<SlmResult> {
    if (input.responseFormat === "json_object") return { content: JSON.stringify({ reply: "Sawa." }) };
    return { content: "Nitaangalia status ya order yako." };
  }
  async isHealthy() {
    return true;
  }
}

export class FakeTts implements TtsProvider {
  async synthesize(input: TtsInput): Promise<TtsResult> {
    const seconds = Math.min(10, Math.max(0.3, input.text.length * 0.06));
    return { audio: buildWav(seconds), contentType: "audio/wav", durationSeconds: seconds };
  }
  async isHealthy() {
    return true;
  }
}

export const fakeProviders = (): Providers => ({ stt: new FakeStt(), slm: new FakeSlm(), tts: new FakeTts() });
