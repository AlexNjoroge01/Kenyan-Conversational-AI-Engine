import { describe, expect, test } from "bun:test";
import { createServices } from "../src/services/container";
import type { SlmInput } from "../src/services/slm/slm.provider";
import { buildWav, fakeProviders } from "./fakes";

const audio = { buffer: buildWav(0.5), originalname: "clip.wav", mimetype: "audio/wav" };

describe("voice pipeline (audio -> STT -> SLM -> TTS -> audio)", () => {
  test("runs all three stages and passes each output to the next", async () => {
    const seen: SlmInput[] = [];
    const providers = {
      ...fakeProviders(),
      slm: {
        complete: async (input: SlmInput) => {
          seen.push(input);
          return { content: "Ndiyo, naweza kukusaidia." };
        },
        isHealthy: async () => true,
      },
    };
    const { pipeline } = createServices(providers);

    const result = await pipeline.runVoiceTurn({
      audio,
      systemPrompt: "Wewe ni msaidizi wa Kenya.",
      history: [{ role: "assistant", content: "Karibu!" }],
      format: "wav",
    });

    expect(result.transcript).toBe("Nataka kujua status ya order yangu.");
    expect(seen[0]!.messages).toEqual([
      { role: "system", content: "Wewe ni msaidizi wa Kenya." },
      { role: "assistant", content: "Karibu!" },
      { role: "user", content: "Nataka kujua status ya order yangu." },
    ]);
    expect(result.reply).toBe("Ndiyo, naweza kukusaidia.");
    expect(result.audio.subarray(0, 4).toString()).toBe("RIFF");
    expect(result.audioDurationSeconds).toBeGreaterThan(0);
    expect(result.timingsMs.total).toBeGreaterThanOrEqual(0);
  });

  test("a failing stage stops the pipeline with that stage's error", async () => {
    const providers = {
      ...fakeProviders(),
      slm: {
        complete: async () => {
          throw new Error("slm down");
        },
        isHealthy: async () => false,
      },
    };
    const { pipeline } = createServices(providers);
    await expect(pipeline.runVoiceTurn({ audio })).rejects.toThrow("slm down");
  });
});
