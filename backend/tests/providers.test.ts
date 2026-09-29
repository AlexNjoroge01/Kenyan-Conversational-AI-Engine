import { describe, expect, test } from "bun:test";
import { cachedHealthCheck, type FetchLike } from "../src/services/provider-http";
import { OpenAiCompatibleSlmProvider, thinkingParams } from "../src/services/slm/openai-compatible-slm.provider";
import { QwenSlmProvider } from "../src/services/slm/qwen-slm.provider";
import { stripThinking } from "../src/services/slm/thinking";
import { GroqSttProvider, uploadFilename } from "../src/services/stt/groq-stt.provider";
import { toLanguageCode } from "../src/services/stt/languages";
import { WhisperSttProvider } from "../src/services/stt/whisper-stt.provider";
import { SautiTtsProvider } from "../src/services/tts/sauti-tts.provider";
import type { AppError, ErrorCode } from "../src/utils/errors";

// Every provider here gets a mocked fetch: no test talks to Groq, Hugging Face, OpenRouter, ngrok or Kaggle.

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fn, calls };
}

/** Never answers; rejects only when the caller's timeout aborts it. */
const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

/** Like a DNS failure or a refused connection. */
const unreachableFetch: FetchLike = async () => {
  throw new TypeError("fetch failed: connect ECONNREFUSED 10.1.2.3:443");
};

// Things that must never appear in a client-facing error.
const SECRETS = ["gsk_live_secret", "worker-secret-value", "or-secret", "xyz.ngrok-free.app", "api.groq.com", "Traceback"];
const leakyBody = "Traceback: model.py line 9; key gsk_live_secret at https://xyz.ngrok-free.app via api.groq.com";

const respond = (status: number, body: string | null = leakyBody, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    return err as AppError;
  }
  throw new Error("expected the call to fail");
}

function expectNoLeak(err: AppError) {
  const exposed = JSON.stringify({ message: err.message, code: err.code, details: err.details, headers: err.headers });
  for (const secret of SECRETS) expect(exposed).not.toContain(secret);
}

const headerOf = (call: Call, name: string) => new Headers(call.init.headers).get(name);

const wav = Buffer.from("RIFF....WAVEfmt fake audio");
const sttInput = { audio: wav, filename: "clip.wav", mimeType: "audio/wav", language: "sw" };
const slmInput = { messages: [{ role: "user" as const, content: "Habari" }] };
const ttsInput = { text: "Habari, karibu.", voice: "default", format: "wav" as const };

// --- A shared error-mapping matrix, run against every remote provider --------------------------------

interface ProviderCase {
  name: string;
  unavailable: ErrorCode;
  failed: ErrorCode;
  make: (fetch: FetchLike, timeoutMs?: number) => { call: () => Promise<unknown> };
  /** A 200 response whose body breaks the contract. */
  malformed: () => Response;
}

const workerOptions = (fetch: FetchLike, timeoutMs = 2_000) => ({
  baseUrl: "https://xyz.ngrok-free.app",
  timeoutMs,
  workerApiKey: "worker-secret-value",
  fetch,
});

const providers: ProviderCase[] = [
  {
    name: "GroqSttProvider",
    unavailable: "STT_UNAVAILABLE",
    failed: "STT_TRANSCRIPTION_FAILED",
    make: (fetch, timeoutMs = 2_000) => {
      const p = new GroqSttProvider({ apiKey: "gsk_live_secret", model: "whisper-large-v3-turbo", timeoutMs, fetch });
      return { call: () => p.transcribe(sttInput) };
    },
    malformed: () => Response.json({ transcript: "wrong field" }),
  },
  {
    name: "WhisperSttProvider (worker)",
    unavailable: "STT_UNAVAILABLE",
    failed: "STT_TRANSCRIPTION_FAILED",
    make: (fetch, timeoutMs) => {
      const p = new WhisperSttProvider(workerOptions(fetch, timeoutMs));
      return { call: () => p.transcribe(sttInput) };
    },
    malformed: () => new Response("<html>not json</html>", { status: 200 }),
  },
  {
    name: "QwenSlmProvider (worker)",
    unavailable: "SLM_UNAVAILABLE",
    failed: "SLM_COMPLETION_FAILED",
    make: (fetch, timeoutMs) => {
      const p = new QwenSlmProvider(workerOptions(fetch, timeoutMs));
      return { call: () => p.complete(slmInput) };
    },
    malformed: () => Response.json({ text: 42 }),
  },
  {
    name: "OpenAiCompatibleSlmProvider",
    unavailable: "SLM_UNAVAILABLE",
    failed: "SLM_COMPLETION_FAILED",
    make: (fetch, timeoutMs = 2_000) => {
      const p = new OpenAiCompatibleSlmProvider({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "or-secret",
        model: "qwen/qwen3.5-9b",
        timeoutMs,
        fetch,
      });
      return { call: () => p.complete(slmInput) };
    },
    malformed: () => Response.json({ choices: [] }),
  },
  {
    name: "SautiTtsProvider (worker)",
    unavailable: "TTS_UNAVAILABLE",
    failed: "TTS_GENERATION_FAILED",
    make: (fetch, timeoutMs) => {
      const p = new SautiTtsProvider(workerOptions(fetch, timeoutMs));
      return { call: () => p.synthesize(ttsInput) };
    },
    // ngrok's browser-warning interstitial is an HTML page served with 200.
    malformed: () => new Response("<html>ngrok</html>", { status: 200, headers: { "content-type": "text/html" } }),
  },
];

describe.each(providers)("$name error mapping", (pc) => {
  test("timeout -> *_UNAVAILABLE (503)", async () => {
    const err = await errorOf(pc.make(hangingFetch, 50).call());
    expect(err.code).toBe(pc.unavailable);
    expect(err.status).toBe(503);
    expect(err.message).toContain("did not respond in time");
  });

  test("worker/host offline (connection refused) -> *_UNAVAILABLE (503)", async () => {
    const err = await errorOf(pc.make(unreachableFetch).call());
    expect(err.code).toBe(pc.unavailable);
    expect(err.status).toBe(503);
    expectNoLeak(err);
  });

  test("offline ngrok tunnel (404 ERR_NGROK_3200) -> *_UNAVAILABLE (503)", async () => {
    const { fn } = mockFetch(() => respond(404, "ERR_NGROK_3200 xyz.ngrok-free.app is offline", { "ngrok-error-code": "ERR_NGROK_3200" }));
    const err = await errorOf(pc.make(fn).call());
    expect(err.code).toBe(pc.unavailable);
    expectNoLeak(err);
  });

  test.each([401, 403])("%i (missing/wrong key) -> *_UNAVAILABLE (503), no key or body leaked", async (status) => {
    const { fn } = mockFetch(() => respond(status));
    const err = await errorOf(pc.make(fn).call());
    expect(err.code).toBe(pc.unavailable);
    expect(err.status).toBe(503);
    expectNoLeak(err);
  });

  test("429 -> RATE_LIMITED (429) with a sanitised Retry-After", async () => {
    const { fn } = mockFetch(() => respond(429, leakyBody, { "retry-after": "7" }));
    const err = await errorOf(pc.make(fn).call());
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.status).toBe(429);
    expect(err.headers).toEqual({ "Retry-After": "7" });
    expectNoLeak(err);

    const capped = mockFetch(() => respond(429, leakyBody, { "retry-after": "99999" }));
    expect((await errorOf(pc.make(capped.fn).call())).headers).toEqual({ "Retry-After": "120" });
    const none = mockFetch(() => respond(429, leakyBody, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }));
    expect((await errorOf(pc.make(none.fn).call())).headers).toBeUndefined();
  });

  test("500 -> *_FAILED (502) without leaking the body", async () => {
    const { fn } = mockFetch(() => respond(500));
    const err = await errorOf(pc.make(fn).call());
    expect(err.code).toBe(pc.failed);
    expect(err.status).toBe(502);
    expectNoLeak(err);
  });

  test.each([502, 503, 504])("%i -> *_UNAVAILABLE (503)", async (status) => {
    const { fn } = mockFetch(() => respond(status));
    expect((await errorOf(pc.make(fn).call())).code).toBe(pc.unavailable);
  });

  test.each([400, 422])("%i (input rejected) -> *_FAILED (422)", async (status) => {
    const { fn } = mockFetch(() => respond(status, JSON.stringify({ error: { code: "INPUT_TOO_LONG", message: leakyBody } })));
    const err = await errorOf(pc.make(fn).call());
    expect(err.code).toBe(pc.failed);
    expect(err.status).toBe(422);
    expectNoLeak(err);
  });

  test("413 -> PAYLOAD_TOO_LARGE", async () => {
    const { fn } = mockFetch(() => respond(413));
    expect((await errorOf(pc.make(fn).call())).code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("malformed 200 response -> *_FAILED (502)", async () => {
    const { fn } = mockFetch(() => pc.malformed());
    const err = await errorOf(pc.make(fn).call());
    expect(err.code).toBe(pc.failed);
    expect(err.status).toBe(502);
  });
});

// --- Groq STT -------------------------------------------------------------------------------------------

describe("GroqSttProvider", () => {
  const make = (fetch: FetchLike) =>
    new GroqSttProvider({ apiKey: "gsk_live_secret", model: "whisper-large-v3-turbo", timeoutMs: 2_000, fetch });

  test("posts a verbose_json multipart request and normalises the result", async () => {
    const { fn, calls } = mockFetch(() =>
      Response.json({ text: "  Nataka kujua status ya order yangu. ", language: "Swahili", duration: 3.2, x_groq: { id: "req_x" } }),
    );
    const result = await make(fn).transcribe(sttInput);

    expect(result).toEqual({ text: "Nataka kujua status ya order yangu.", language: "sw", durationSeconds: 3.2 });
    const [call] = calls;
    expect(call!.url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(call!.init.method).toBe("POST");
    expect(headerOf(call!, "authorization")).toBe("Bearer gsk_live_secret");
    const form = call!.init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("language")).toBe("sw");
    expect((form.get("file") as File).name).toBe("clip.wav");
    expect((form.get("file") as File).size).toBe(wav.length);
  });

  test("omits language when not given and falls back to 'und' if Groq does not report one", async () => {
    const { fn, calls } = mockFetch(() => Response.json({ text: "Hello" }));
    const result = await make(fn).transcribe({ ...sttInput, language: undefined });
    expect((calls[0]!.init.body as FormData).has("language")).toBe(false);
    expect(result).toEqual({ text: "Hello", language: "und", durationSeconds: undefined });
  });

  test("accepts ISO codes as well as language names", async () => {
    const { fn } = mockFetch(() => Response.json({ text: "Hello", language: "en" }));
    expect((await make(fn).transcribe(sttInput)).language).toBe("en");
  });

  test("gives extension-less uploads (e.g. browser recordings) a filename Groq accepts", () => {
    expect(uploadFilename("blob", "audio/webm;codecs=opus")).toBe("audio.webm");
    expect(uploadFilename("recording", "audio/x-m4a")).toBe("audio.m4a");
    expect(uploadFilename("voice.MP3", "audio/mpeg")).toBe("voice.MP3");
    expect(uploadFilename("clip.aac", "audio/ogg")).toBe("audio.ogg");
  });

  test("health checks GET /models with the key and caches the result", async () => {
    const { fn, calls } = mockFetch(() => Response.json({ data: [] }));
    const provider = make(fn);
    expect(await provider.isHealthy()).toBe(true);
    expect(await provider.isHealthy()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/models");
    expect(headerOf(calls[0]!, "authorization")).toBe("Bearer gsk_live_secret");
  });

  test("health is false when Groq rejects the key or is unreachable", async () => {
    expect(await make(mockFetch(() => respond(401)).fn).isHealthy()).toBe(false);
    expect(await make(unreachableFetch).isHealthy()).toBe(false);
  });
});

describe("toLanguageCode", () => {
  test.each([
    ["Swahili", "sw"],
    ["english", "en"],
    ["sw", "sw"],
    [" EN ", "en"],
    ["haitian creole", "ht"],
    ["klingon", "fallback"],
    [undefined, "fallback"],
    [42, "fallback"],
  ])("%p -> %p", (input, expected) => {
    expect(toLanguageCode(input, "fallback")).toBe(expected);
  });
});

// --- Self-hosted GPU worker (Kaggle via ngrok) -----------------------------------------------------------

describe("GPU worker providers", () => {
  test("every worker call carries X-Worker-Key and the ngrok bypass header", async () => {
    const { fn, calls } = mockFetch((url) => {
      if (url.endsWith("/synthesize")) return new Response(wav, { headers: { "content-type": "audio/wav" } });
      if (url.endsWith("/complete")) return Response.json({ content: "Sawa." });
      return Response.json({ text: "habari", language: "sw" });
    });
    await new SautiTtsProvider(workerOptions(fn)).synthesize(ttsInput);
    await new QwenSlmProvider(workerOptions(fn)).complete(slmInput);
    await new WhisperSttProvider(workerOptions(fn)).transcribe(sttInput);

    expect(calls.map((c) => c.url)).toEqual([
      "https://xyz.ngrok-free.app/synthesize",
      "https://xyz.ngrok-free.app/complete",
      "https://xyz.ngrok-free.app/transcribe",
    ]);
    for (const call of calls) {
      expect(headerOf(call, "x-worker-key")).toBe("worker-secret-value");
      expect(headerOf(call, "ngrok-skip-browser-warning")).toBe("true");
    }
  });

  test("without a configured key no X-Worker-Key header is sent (and the worker's 401 becomes *_UNAVAILABLE)", async () => {
    const { fn, calls } = mockFetch((_url, init) =>
      new Headers(init.headers).get("x-worker-key")
        ? new Response(wav, { headers: { "content-type": "audio/wav" } })
        : Response.json({ error: { code: "UNAUTHORIZED", message: "Missing or invalid X-Worker-Key." } }, { status: 401 }),
    );
    const provider = new SautiTtsProvider({ ...workerOptions(fn), workerApiKey: undefined });
    const err = await errorOf(provider.synthesize(ttsInput));
    expect(headerOf(calls[0]!, "x-worker-key")).toBeNull();
    expect(err.code).toBe("TTS_UNAVAILABLE");
  });

  test("a wrong key is rejected by the worker the same way", async () => {
    const { fn } = mockFetch((_url, init) =>
      new Headers(init.headers).get("x-worker-key") === "the-real-key"
        ? new Response(wav, { headers: { "content-type": "audio/wav" } })
        : Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    );
    expect((await errorOf(new SautiTtsProvider(workerOptions(fn)).synthesize(ttsInput))).code).toBe("TTS_UNAVAILABLE");
  });

  test("SautiTtsProvider returns audio, content type and duration", async () => {
    const { fn, calls } = mockFetch(() =>
      new Response(wav, { headers: { "content-type": "audio/wav", "x-audio-duration-seconds": "1.75" } }),
    );
    const result = await new SautiTtsProvider(workerOptions(fn)).synthesize(ttsInput);
    expect(result).toEqual({ audio: wav, contentType: "audio/wav", durationSeconds: 1.75 });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ text: "Habari, karibu.", voice: "default", format: "wav" });
  });

  test("SautiTtsProvider rejects empty audio", async () => {
    const { fn } = mockFetch(() => new Response(new Uint8Array(), { headers: { "content-type": "audio/wav" } }));
    expect((await errorOf(new SautiTtsProvider(workerOptions(fn)).synthesize(ttsInput))).code).toBe("TTS_GENERATION_FAILED");
  });

  test("QwenSlmProvider sends the worker contract and strips <think> blocks", async () => {
    const { fn, calls } = mockFetch(() => Response.json({ content: "<think>\nuser wants order status\n</think>\n\nNitaangalia order yako." }));
    const result = await new QwenSlmProvider(workerOptions(fn)).complete({
      messages: [{ role: "user", content: "Order yangu iko wapi?" }],
      temperature: 0.2,
      maxTokens: 64,
      responseFormat: "json_object",
    });
    expect(result).toEqual({ content: "Nitaangalia order yako." });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      messages: [{ role: "user", content: "Order yangu iko wapi?" }],
      temperature: 0.2,
      max_tokens: 64,
      response_format: "json_object",
    });
  });

  test("QwenSlmProvider treats a reply that is only thinking as a failure", async () => {
    const { fn } = mockFetch(() => Response.json({ content: "<think>I was cut off mid-thought" }));
    const err = await errorOf(new QwenSlmProvider(workerOptions(fn)).complete(slmInput));
    expect(err.code).toBe("SLM_COMPLETION_FAILED");
    expect(err.message).toContain("empty");
  });

  test("health reads the per-model status from the worker's /health", async () => {
    const { fn, calls } = mockFetch(() => Response.json({ status: "degraded", models: { tts: false, slm: true } }));
    expect(await new SautiTtsProvider(workerOptions(fn)).isHealthy()).toBe(false);
    expect(await new QwenSlmProvider(workerOptions(fn)).isHealthy()).toBe(true);
    expect(calls[0]!.url).toBe("https://xyz.ngrok-free.app/health");
    expect(headerOf(calls[0]!, "ngrok-skip-browser-warning")).toBe("true");
  });

  test("health is false when the worker is offline", async () => {
    const offline = mockFetch(() => respond(404, "ERR_NGROK_3200"));
    expect(await new SautiTtsProvider(workerOptions(offline.fn)).isHealthy()).toBe(false);
    expect(await new QwenSlmProvider(workerOptions(unreachableFetch)).isHealthy()).toBe(false);
    expect(await new SautiTtsProvider(workerOptions(hangingFetch)).isHealthy()).toBe(false);
  });

  test("a worker without per-model status is healthy when it answers 2xx", async () => {
    const { fn } = mockFetch(() => Response.json({ status: "ok" }));
    expect(await new WhisperSttProvider(workerOptions(fn)).isHealthy()).toBe(true);
  });
});

// --- OpenAI-compatible fallback SLM -------------------------------------------------------------------

describe("OpenAiCompatibleSlmProvider", () => {
  const completion = (content: unknown, extra: Record<string, unknown> = {}) =>
    Response.json({ id: "gen-1", choices: [{ index: 0, message: { role: "assistant", content, ...extra } }] });

  test("maps our request to the host's model and disables thinking OpenRouter-style", async () => {
    const { fn, calls } = mockFetch(() => completion("Habari! Naweza kukusaidia nini?"));
    const provider = new OpenAiCompatibleSlmProvider({
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "or-secret",
      model: "qwen/qwen3.5-9b",
      timeoutMs: 2_000,
      fetch: fn,
    });
    const result = await provider.complete({ messages: [{ role: "user", content: "Habari" }], temperature: 0.3, maxTokens: 100 });

    expect(result).toEqual({ content: "Habari! Naweza kukusaidia nini?" });
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headerOf(calls[0]!, "authorization")).toBe("Bearer or-secret");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      model: "qwen/qwen3.5-9b",
      messages: [{ role: "user", content: "Habari" }],
      stream: false,
      temperature: 0.3,
      max_tokens: 100,
      reasoning: { enabled: false },
    });
  });

  test("uses chat_template_kwargs for other hosts and maps json_object", async () => {
    const { fn, calls } = mockFetch(() => completion('{"intent":"order_status"}'));
    const provider = new OpenAiCompatibleSlmProvider({
      baseUrl: "https://router.huggingface.co/v1",
      apiKey: "hf-secret",
      model: "Qwen/Qwen3.5-9B:deepinfra",
      timeoutMs: 2_000,
      fetch: fn,
    });
    await provider.complete({ messages: [{ role: "user", content: "Order" }], responseFormat: "json_object" });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.reasoning).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  test("strips <think> from content and ignores separate reasoning fields", async () => {
    const { fn } = mockFetch(() => completion("<think>reasoning here</think>Sawa, nimeelewa.", { reasoning: "hidden chain of thought" }));
    const provider = new OpenAiCompatibleSlmProvider({ baseUrl: "https://openrouter.ai/api/v1", model: "m", timeoutMs: 2_000, fetch: fn });
    expect(await provider.complete(slmInput)).toEqual({ content: "Sawa, nimeelewa." });
  });

  test("null content (reasoning-only reply) is a failure", async () => {
    const { fn } = mockFetch(() => completion(null, { reasoning: "..." }));
    const provider = new OpenAiCompatibleSlmProvider({ baseUrl: "https://openrouter.ai/api/v1", model: "m", timeoutMs: 2_000, fetch: fn });
    expect((await errorOf(provider.complete(slmInput))).code).toBe("SLM_COMPLETION_FAILED");
  });

  test("sends no Authorization header when no key is configured (e.g. a private vLLM server)", async () => {
    const { fn, calls } = mockFetch(() => completion("ok"));
    const provider = new OpenAiCompatibleSlmProvider({ baseUrl: "http://10.0.0.5:8000/v1", model: "m", timeoutMs: 2_000, fetch: fn });
    await provider.complete(slmInput);
    expect(headerOf(calls[0]!, "authorization")).toBeNull();
  });

  test("thinkingParams honours explicit settings", () => {
    expect(thinkingParams("none", "https://openrouter.ai/api/v1")).toEqual({});
    expect(thinkingParams("chat_template_kwargs", "https://openrouter.ai/api/v1")).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(thinkingParams("reasoning", "https://router.huggingface.co/v1")).toEqual({ reasoning: { enabled: false } });
  });
});

describe("stripThinking", () => {
  test.each([
    ["<think>\nhmm\n</think>\n\nJibu.", "Jibu."],
    ["<THINK>a</THINK>b<think>c</think>d", "bd"],
    ["reasoning leaked without opening tag</think>\nJibu.", "Jibu."],
    ["Jibu la kwanza. <think>cut off", "Jibu la kwanza."],
    ["<think></think>", ""],
    ["No thinking at all.", "No thinking at all."],
  ])("%p -> %p", (input, expected) => {
    expect(stripThinking(input)).toBe(expected);
  });
});

describe("cachedHealthCheck", () => {
  test("reuses a recent result and shares one in-flight probe", async () => {
    let calls = 0;
    const check = cachedHealthCheck(async () => {
      calls++;
      await Bun.sleep(10);
      return true;
    }, 1_000);
    expect(await Promise.all([check(), check(), check()])).toEqual([true, true, true]);
    expect(await check()).toBe(true);
    expect(calls).toBe(1);
  });

  test("expires after the TTL and treats a throwing check as unhealthy", async () => {
    let healthy = true;
    const check = cachedHealthCheck(async () => {
      if (!healthy) throw new Error("boom");
      return true;
    }, 5);
    expect(await check()).toBe(true);
    healthy = false;
    await Bun.sleep(10);
    expect(await check()).toBe(false);
  });
});
