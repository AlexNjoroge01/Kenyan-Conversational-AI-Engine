import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SlmInput, SlmProvider } from "../src/services/slm/slm.provider";
import { bearer, newApiKey, postJson, startServer, type TestServer } from "./helpers";

const received: SlmInput[] = [];
let reply = "Habari! Naweza kukusaidia nini?";
const spy: SlmProvider = {
  complete: async (input) => {
    received.push(input);
    return { content: reply };
  },
  isHealthy: async () => true,
};

let server: TestServer;
let key: string;
beforeAll(async () => {
  server = await startServer({ slm: spy });
  key = (await newApiKey(server.url)).key;
});
afterAll(() => server.close());

const chat = (body: unknown, headers = bearer(key)) => postJson(`${server.url}/v1/chat/completions`, body, headers);

describe("POST /v1/chat/completions", () => {
  test("returns an OpenAI-style completion", async () => {
    reply = "Habari! Naweza kukusaidia nini?";
    const res = await chat({ model: "qwen3.5-4b", messages: [{ role: "user", content: "Habari" }] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toStartWith("chat_");
    expect(body.model).toBe("qwen3.5-4b");
    expect(body.choices[0]).toEqual({
      index: 0,
      message: { role: "assistant", content: "Habari! Naweza kukusaidia nini?" },
      finish_reason: "stop",
    });
    expect(body.latencyMs).toBeUndefined();
  });

  test("forwards system, user and assistant history in order", async () => {
    received.length = 0;
    const messages = [
      { role: "system", content: "Wewe ni msaidizi." },
      { role: "user", content: "Habari" },
      { role: "assistant", content: "Nzuri." },
      { role: "user", content: "Order yangu iko wapi?" },
    ];
    await chat({ model: "qwen3.5-4b", messages, temperature: 0.2, max_tokens: 64 });
    expect(received[0]).toMatchObject({ messages, temperature: 0.2, maxTokens: 64 });
  });

  test("supports structured JSON output and validates it", async () => {
    reply = '{"intent":"order_status"}';
    const ok = await chat({
      model: "qwen3.5-4b",
      messages: [{ role: "user", content: "Order yangu" }],
      response_format: { type: "json_object" },
    });
    expect(ok.status).toBe(200);
    expect(received.at(-1)!.responseFormat).toBe("json_object");

    reply = "not json at all";
    const bad = await chat({
      model: "qwen3.5-4b",
      messages: [{ role: "user", content: "Order yangu" }],
      response_format: { type: "json_object" },
    });
    expect(bad.status).toBe(502);
    expect((await bad.json()).error.code).toBe("SLM_COMPLETION_FAILED");
  });

  test("requires an API key", async () => {
    const res = await chat({ model: "qwen3.5-4b", messages: [{ role: "user", content: "Habari" }] }, {});
    expect(res.status).toBe(401);
  });

  test("rejects an unsupported model", async () => {
    const res = await chat({ model: "gpt-4", messages: [{ role: "user", content: "Habari" }] });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("MODEL_NOT_FOUND");
  });

  test.each([
    ["no messages", { model: "qwen3.5-4b", messages: [] }],
    ["missing messages", { model: "qwen3.5-4b" }],
    ["invalid role", { model: "qwen3.5-4b", messages: [{ role: "robot", content: "hi" }] }],
    ["empty content", { model: "qwen3.5-4b", messages: [{ role: "user", content: "" }] }],
    ["out-of-range temperature", { model: "qwen3.5-4b", messages: [{ role: "user", content: "hi" }], temperature: 5 }],
  ])("rejects %s", async (_name, body) => {
    const res = await chat(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  test("returns a clear error for stream: true", async () => {
    const res = await chat({ model: "qwen3.5-4b", messages: [{ role: "user", content: "hi" }], stream: true });
    expect(res.status).toBe(501);
  });
});
