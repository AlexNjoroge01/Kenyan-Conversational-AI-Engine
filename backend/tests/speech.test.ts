import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AppError } from "../src/utils/errors";
import type { TtsProvider } from "../src/services/tts/tts.provider";
import { bearer, newApiKey, postJson, startServer, waitForUsageEvent, type TestServer } from "./helpers";

class FailingTts implements TtsProvider {
  constructor(private readonly error: AppError) {}
  async synthesize(): Promise<never> {
    throw this.error;
  }
  async isHealthy() {
    return false;
  }
}

let server: TestServer;
let key: string;
beforeAll(async () => {
  server = await startServer();
  key = (await newApiKey(server.url)).key;
});
afterAll(() => server.close());

const speech = (body: unknown, headers: Record<string, string> = bearer(key)) =>
  postJson(`${server.url}/v1/audio/speech`, body, headers);

describe("POST /v1/audio/speech", () => {
  test("returns playable audio for a valid request", async () => {
    const res = await speech({
      model: "sauti-v2",
      input: "Nimefika office, I will call you nikimaliza meeting.",
      voice: "default",
      response_format: "wav",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-request-id")).toStartWith("req_");
    const audio = Buffer.from(await res.arrayBuffer());
    expect(audio.subarray(0, 4).toString()).toBe("RIFF");
    expect(audio.length).toBeGreaterThan(1000);
  });

  test("applies defaults (voice, response_format, stream) when only model and input are sent", async () => {
    const res = await speech({ model: "sauti-v2", input: "Habari, karibu Kenya." });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("records a usage event", async () => {
    const res = await speech({ model: "sauti-v2", input: "Habari", response_format: "wav" });
    const requestId = res.headers.get("x-request-id")!;
    const event = await waitForUsageEvent(requestId);
    expect(event).toMatchObject({
      endpoint: "/v1/audio/speech",
      model: "sauti-v2",
      status: 200,
      inputCharacters: 6,
      errorCode: null,
    });
    expect(event!.userId).toBeString();
    expect(event!.apiKeyId).toBeString();
    expect(event!.audioDurationSeconds).toBeGreaterThan(0);
  });

  test("records failed requests with their error code", async () => {
    const res = await speech({ model: "nope", input: "Habari" });
    const event = await waitForUsageEvent(res.headers.get("x-request-id")!);
    expect(event).toMatchObject({ status: 404, errorCode: "MODEL_NOT_FOUND" });
  });

  test("rejects a missing API key", async () => {
    const res = await speech({ model: "sauti-v2", input: "Habari" }, {});
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  test("rejects an invalid API key", async () => {
    const res = await speech({ model: "sauti-v2", input: "Habari" }, bearer("sk_live_invalid"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("API_KEY_INVALID");
  });

  test("rejects an unsupported model", async () => {
    const res = await speech({ model: "msingiai/sauti_tts_v2", input: "Habari" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("MODEL_NOT_FOUND");
  });

  test.each([
    ["empty input", { model: "sauti-v2", input: "" }],
    ["whitespace-only input", { model: "sauti-v2", input: "   " }],
    ["missing input", { model: "sauti-v2" }],
    ["missing model", { input: "Habari" }],
    ["oversized input", { model: "sauti-v2", input: "a".repeat(501) }],
    ["unsupported format", { model: "sauti-v2", input: "Habari", response_format: "ogg" }],
    ["unsupported voice", { model: "sauti-v2", input: "Habari", voice: "nobody" }],
    ["non-string input", { model: "sauti-v2", input: 42 }],
  ])("rejects %s", async (_name, body) => {
    const res = await speech(body);
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.requestId).toStartWith("req_");
  });

  test("rejects malformed JSON", async () => {
    const res = await fetch(`${server.url}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bearer(key) },
      body: "{oops",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  test("returns a clear error for stream: true instead of faking streaming", async () => {
    const res = await speech({ model: "sauti-v2", input: "Habari", stream: true });
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("NOT_IMPLEMENTED");
  });
});

describe("worker failures", () => {
  test("TTS worker unavailable -> 503 TTS_UNAVAILABLE without leaking internals", async () => {
    const failing = await startServer({
      tts: new FailingTts(new AppError("TTS_UNAVAILABLE", "The text-to-speech service is currently unavailable.", 503)),
    });
    try {
      const res = await postJson(`${failing.url}/v1/audio/speech`, { model: "sauti-v2", input: "Habari" }, bearer((await newApiKey(failing.url)).key));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("TTS_UNAVAILABLE");
    } finally {
      await failing.close();
    }
  });

  test("unexpected provider exceptions become a generic 500", async () => {
    const broken = await startServer({
      tts: {
        synthesize: async () => {
          throw new Error("CUDA out of memory at /srv/secret/path.py:42");
        },
        isHealthy: async () => true,
      },
    });
    try {
      const res = await postJson(`${broken.url}/v1/audio/speech`, { model: "sauti-v2", input: "Habari" }, bearer((await newApiKey(broken.url)).key));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toContain("INTERNAL_ERROR");
      expect(text).not.toContain("CUDA");
      expect(text).not.toContain("secret");
    } finally {
      await broken.close();
    }
  });
});
