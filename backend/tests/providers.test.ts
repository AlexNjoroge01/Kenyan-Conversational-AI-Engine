import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { QwenSlmProvider } from "../src/services/slm/qwen-slm.provider";
import { WhisperSttProvider } from "../src/services/stt/whisper-stt.provider";
import { SautiTtsProvider } from "../src/services/tts/sauti-tts.provider";
import { AppError } from "../src/utils/errors";

// A stand-in for the model workers, speaking the contracts from the Blueprint (§25).
let mode: "ok" | "down" | "error" | "garbage" | "empty" | "slow" = "ok";
let worker: ReturnType<typeof Bun.serve>;
let url: string;

beforeAll(() => {
  worker = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/health") return new Response("ok", { status: mode === "down" ? 503 : 200 });
      if (mode === "down") return new Response("down", { status: 503 });
      if (mode === "error") return new Response("boom: /srv/model.py line 9", { status: 500 });
      if (mode === "slow") await Bun.sleep(500);
      if (mode === "garbage") return new Response("<html>", { status: 200 });
      if (pathname === "/synthesize") {
        const body = (await req.json()) as { text: string; voice: string; format: string };
        if (mode === "empty") return new Response(new Uint8Array(), { headers: { "content-type": "audio/mpeg" } });
        return new Response(new TextEncoder().encode(`AUDIO:${body.text}:${body.voice}:${body.format}`), {
          headers: { "content-type": "audio/mpeg", "x-audio-duration-seconds": "1.5" },
        });
      }
      if (pathname === "/transcribe") {
        const form = await req.formData();
        const file = form.get("file") as File;
        return Response.json({ text: `heard ${file.size} bytes`, language: String(form.get("language") ?? "sw") });
      }
      if (pathname === "/complete") {
        const body = (await req.json()) as { messages: { content: string }[] };
        return Response.json({ content: `echo: ${body.messages.at(-1)!.content}` });
      }
      return new Response("nope", { status: 404 });
    },
  });
  url = `http://127.0.0.1:${worker.port}`;
});
afterAll(() => worker.stop(true));

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as AppError).code;
  }
  return "no error";
};

describe("SautiTtsProvider", () => {
  const tts = (timeout = 2000, base?: string) => new SautiTtsProvider(base ?? url, timeout);
  const input = { text: "Habari", voice: "default", format: "mp3" as const };

  test("sends the worker contract and returns audio with duration", async () => {
    mode = "ok";
    const result = await tts().synthesize(input);
    expect(result.audio.toString()).toBe("AUDIO:Habari:default:mp3");
    expect(result.contentType).toBe("audio/mpeg");
    expect(result.durationSeconds).toBe(1.5);
  });

  test("maps a connection failure to TTS_UNAVAILABLE", async () => {
    expect(await codeOf(tts(500, "http://127.0.0.1:1").synthesize(input))).toBe("TTS_UNAVAILABLE");
  });

  test("maps a 503 to TTS_UNAVAILABLE, a 500 to TTS_GENERATION_FAILED without leaking the body", async () => {
    mode = "down";
    expect(await codeOf(tts().synthesize(input))).toBe("TTS_UNAVAILABLE");
    mode = "error";
    const err = (await tts().synthesize(input).catch((e) => e)) as AppError;
    expect(err.code).toBe("TTS_GENERATION_FAILED");
    expect(err.message).not.toContain("model.py");
  });

  test("maps a timeout to TTS_UNAVAILABLE", async () => {
    mode = "slow";
    expect(await codeOf(tts(100).synthesize(input))).toBe("TTS_UNAVAILABLE");
  });

  test("rejects an empty generation", async () => {
    mode = "empty";
    expect(await codeOf(tts().synthesize(input))).toBe("TTS_GENERATION_FAILED");
  });

  test("health check reflects the worker", async () => {
    mode = "ok";
    expect(await tts().isHealthy()).toBe(true);
    mode = "down";
    expect(await tts().isHealthy()).toBe(false);
    expect(await tts(500, "http://127.0.0.1:1").isHealthy()).toBe(false);
  });
});

describe("WhisperSttProvider", () => {
  const stt = new WhisperSttProvider("", 2000);
  const make = () => new WhisperSttProvider(url, 2000);

  test("uploads the audio and parses the transcript", async () => {
    mode = "ok";
    const result = await make().transcribe({ audio: Buffer.from("12345"), filename: "a.wav", mimeType: "audio/wav", language: "en" });
    expect(result).toEqual({ text: "heard 5 bytes", language: "en" });
  });

  test("maps failures to STT codes and rejects malformed responses", async () => {
    mode = "down";
    expect(await codeOf(make().transcribe({ audio: Buffer.from("1"), filename: "a.wav", mimeType: "audio/wav" }))).toBe("STT_UNAVAILABLE");
    mode = "error";
    expect(await codeOf(make().transcribe({ audio: Buffer.from("1"), filename: "a.wav", mimeType: "audio/wav" }))).toBe("STT_TRANSCRIPTION_FAILED");
    mode = "garbage";
    expect(await codeOf(make().transcribe({ audio: Buffer.from("1"), filename: "a.wav", mimeType: "audio/wav" }))).toBe("STT_TRANSCRIPTION_FAILED");
    expect(stt).toBeDefined();
  });
});

describe("QwenSlmProvider", () => {
  const make = () => new QwenSlmProvider(url, 2000);

  test("sends messages and returns content", async () => {
    mode = "ok";
    expect(await make().complete({ messages: [{ role: "user", content: "Habari" }] })).toEqual({ content: "echo: Habari" });
  });

  test("maps failures to SLM codes and rejects malformed responses", async () => {
    mode = "down";
    expect(await codeOf(make().complete({ messages: [{ role: "user", content: "x" }] }))).toBe("SLM_UNAVAILABLE");
    mode = "garbage";
    expect(await codeOf(make().complete({ messages: [{ role: "user", content: "x" }] }))).toBe("SLM_COMPLETION_FAILED");
  });
});
