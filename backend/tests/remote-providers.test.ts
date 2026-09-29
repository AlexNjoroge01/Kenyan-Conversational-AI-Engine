import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FetchLike } from "../src/services/provider-http";
import { OpenAiCompatibleSlmProvider } from "../src/services/slm/openai-compatible-slm.provider";
import { GroqSttProvider } from "../src/services/stt/groq-stt.provider";
import { buildWavTone } from "../src/services/tts/mock-tts.provider";
import { SautiTtsProvider } from "../src/services/tts/sauti-tts.provider";
import { bearer, newApiKey, postJson, startServer, waitForUsageEvent, type TestServer } from "./helpers";

// End-to-end through the public API with the real provider classes, each on a mocked fetch.
// Nothing here reaches Groq, OpenRouter or the Kaggle worker.

let ttsReply: () => Response = () => new Response(buildWavTone(0.5), { headers: { "content-type": "audio/wav" } });
const workerFetch: FetchLike = async () => ttsReply();

const groqFetch: FetchLike = async (url) =>
  url.endsWith("/models")
    ? Response.json({ data: [] })
    : Response.json({ text: "Nimefika office, I will call you nikimaliza meeting.", language: "Swahili", duration: 4.25 });

let slmReply: () => Response = () =>
  Response.json({ choices: [{ message: { role: "assistant", content: "<think>plan</think>Sawa, nitakupigia." } }] });
const slmFetch: FetchLike = async () => slmReply();

let server: TestServer;
let key: string;

beforeAll(async () => {
  server = await startServer({
    stt: new GroqSttProvider({ apiKey: "gsk_live_secret", model: "whisper-large-v3-turbo", timeoutMs: 2_000, fetch: groqFetch }),
    slm: new OpenAiCompatibleSlmProvider({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "or-secret",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 2_000,
      fetch: slmFetch,
    }),
    tts: new SautiTtsProvider({
      baseUrl: "https://xyz.ngrok-free.app",
      timeoutMs: 2_000,
      workerApiKey: "worker-secret-value",
      fetch: workerFetch,
    }),
  });
  key = (await newApiKey(server.url)).key;
});
afterAll(() => server.close());

describe("public API over real providers (mocked network)", () => {
  test("transcription keeps the public model ID, returns an ISO language code and records audio duration", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buildWavTone(0.5))], { type: "audio/wav" }), "clip.wav");
    form.append("model", "whisper-large-v3-turbo");
    const res = await fetch(`${server.url}/v1/audio/transcriptions`, { method: "POST", headers: bearer(key), body: form });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "Nimefika office, I will call you nikimaliza meeting.",
      model: "whisper-large-v3-turbo",
      language: "sw",
    });
    const event = await waitForUsageEvent(res.headers.get("x-request-id")!);
    expect(event).toMatchObject({ endpoint: "/v1/audio/transcriptions", model: "whisper-large-v3-turbo", status: 200 });
    expect(event!.audioDurationSeconds).toBe(4.25);
  });

  test("chat returns the public model ID with thinking removed", async () => {
    const res = await postJson(
      `${server.url}/v1/chat/completions`,
      { model: "qwen3.5-4b", messages: [{ role: "user", content: "Nipigie baadaye" }] },
      bearer(key),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("qwen3.5-4b");
    expect(body.choices[0].message.content).toBe("Sawa, nitakupigia.");
    expect(JSON.stringify(body)).not.toContain("qwen/qwen3.5-9b");
  });

  test("speech returns the worker's audio", async () => {
    ttsReply = () => new Response(buildWavTone(0.5), { headers: { "content-type": "audio/wav", "x-audio-duration-seconds": "0.5" } });
    const res = await postJson(`${server.url}/v1/audio/speech`, { model: "sauti-v2", input: "Habari", response_format: "wav" }, bearer(key));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const event = await waitForUsageEvent(res.headers.get("x-request-id")!);
    expect(event).toMatchObject({ status: 200, audioDurationSeconds: 0.5 });
  });

  test("worker offline -> 503 TTS_UNAVAILABLE, recorded, with no worker URL in the response", async () => {
    ttsReply = () => new Response("Tunnel xyz.ngrok-free.app not found (ERR_NGROK_3200)", { status: 404 });
    const res = await postJson(`${server.url}/v1/audio/speech`, { model: "sauti-v2", input: "Habari" }, bearer(key));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("TTS_UNAVAILABLE");
    expect(text).not.toContain("ngrok");
    const event = await waitForUsageEvent(res.headers.get("x-request-id")!);
    expect(event).toMatchObject({ status: 503, errorCode: "TTS_UNAVAILABLE", model: "sauti-v2" });
  });

  test("provider rate limit -> 429 RATE_LIMITED with Retry-After, recorded", async () => {
    slmReply = () => new Response('{"error":{"message":"quota for or-secret exceeded"}}', { status: 429, headers: { "retry-after": "12" } });
    const res = await postJson(
      `${server.url}/v1/chat/completions`,
      { model: "qwen3.5-4b", messages: [{ role: "user", content: "Habari" }] },
      bearer(key),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("RATE_LIMITED");
    expect(text).not.toContain("or-secret");
    const event = await waitForUsageEvent(res.headers.get("x-request-id")!);
    expect(event).toMatchObject({ status: 429, errorCode: "RATE_LIMITED" });
  });

  test("/ready reports each provider's reachability without naming the providers", async () => {
    slmReply = () => Response.json({ data: [] });
    ttsReply = () => Response.json({ status: "degraded", models: { tts: false, slm: true } });
    const res = await fetch(`${server.url}/ready`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      status: "not_ready",
      dependencies: { database: "ok", stt: "ok", slm: "ok", tts: "unavailable" },
    });
    expect(res.status).toBe(503);
    for (const hidden of ["groq", "openrouter", "ngrok", "worker"]) expect(text.toLowerCase()).not.toContain(hidden);
  });
});
