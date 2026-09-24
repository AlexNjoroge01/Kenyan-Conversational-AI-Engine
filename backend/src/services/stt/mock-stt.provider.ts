import type { SttInput, SttProvider, SttResult } from "./stt.provider";

/** Development/test stand-in: ignores the audio and returns a fixed Kiswahili/English transcript. */
export class MockSttProvider implements SttProvider {
  async transcribe(input: SttInput): Promise<SttResult> {
    return { text: "Nataka kujua status ya order yangu.", language: input.language ?? "sw" };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
