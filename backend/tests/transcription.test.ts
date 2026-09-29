import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildWav } from "./fakes";
import { bearer, newApiKey, startServer, type TestServer } from "./helpers";

let server: TestServer;
let key: string;
beforeAll(async () => {
  server = await startServer();
  key = (await newApiKey(server.url)).key;
});
afterAll(() => server.close());

const wav = () => new Blob([new Uint8Array(buildWav(0.5))], { type: "audio/wav" });

function transcribe(fields: { file?: Blob; model?: string; language?: string }, headers = bearer(key)) {
  const form = new FormData();
  if (fields.file) form.append("file", fields.file, "clip.wav");
  if (fields.model) form.append("model", fields.model);
  if (fields.language) form.append("language", fields.language);
  return fetch(`${server.url}/v1/audio/transcriptions`, { method: "POST", headers, body: form });
}

describe("POST /v1/audio/transcriptions", () => {
  test("returns a transcript for a valid upload", async () => {
    const res = await transcribe({ file: wav(), model: "whisper-large-v3-turbo" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "Nataka kujua status ya order yangu.",
      model: "whisper-large-v3-turbo",
      language: "sw",
    });
  });

  test("passes the optional language through", async () => {
    const res = await transcribe({ file: wav(), model: "whisper-large-v3-turbo", language: "en" });
    expect((await res.json()).language).toBe("en");
  });

  test("requires an API key", async () => {
    const res = await transcribe({ file: wav(), model: "whisper-large-v3-turbo" }, {});
    expect(res.status).toBe(401);
  });

  test("rejects a missing file", async () => {
    const res = await transcribe({ model: "whisper-large-v3-turbo" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details[0].field).toBe("file");
  });

  test("rejects an unsupported media type", async () => {
    const res = await transcribe({ file: new Blob(["hello"], { type: "text/plain" }), model: "whisper-large-v3-turbo" });
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  test("rejects an oversized file", async () => {
    const big = new Blob([new Uint8Array(1_048_576 + 1024)], { type: "audio/wav" });
    const res = await transcribe({ file: big, model: "whisper-large-v3-turbo" });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("rejects an unsupported model", async () => {
    const res = await transcribe({ file: wav(), model: "whisper-1" });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("MODEL_NOT_FOUND");
  });

  test("rejects a missing model and a bad language code", async () => {
    expect((await transcribe({ file: wav() })).status).toBe(400);
    expect((await transcribe({ file: wav(), model: "whisper-large-v3-turbo", language: "Swahili" })).status).toBe(400);
  });
});
