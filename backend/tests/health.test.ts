import { afterAll, describe, expect, test } from "bun:test";
import { MockTtsProvider } from "../src/services/tts/mock-tts.provider";
import { startServer } from "./helpers";

const servers: { close: () => Promise<void> }[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

describe("health", () => {
  test("GET / returns the service name, version and a link to the docs", async () => {
    const server = await startServer();
    servers.push(server);
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ name: "Kenyan Conversational AI API", version: expect.any(String), docs: "/docs", openapi: "/openapi.json" });
    expect((await fetch(`${server.url}/`, { method: "HEAD" })).status).toBe(200);
  });

  test("GET /health returns ok", async () => {
    const server = await startServer();
    servers.push(server);
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("GET /ready reports every dependency when all are up", async () => {
    const server = await startServer();
    servers.push(server);
    const res = await fetch(`${server.url}/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ready",
      dependencies: { database: "ok", stt: "ok", slm: "ok", tts: "ok" },
    });
  });

  test("GET /ready returns 503 when the TTS worker is down", async () => {
    const server = await startServer({ tts: Object.assign(new MockTtsProvider(), { isHealthy: async () => false }) });
    servers.push(server);
    const res = await fetch(`${server.url}/ready`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("not_ready");
    expect(body.dependencies).toMatchObject({ database: "ok", tts: "unavailable" });
  });
});

describe("platform behaviour", () => {
  test("every response carries an X-Request-ID, including 404s with the standard error shape", async () => {
    const server = await startServer();
    servers.push(server);
    const res = await fetch(`${server.url}/nope`);
    expect(res.status).toBe(404);
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toStartWith("req_");
    expect((await res.json()).error).toEqual({
      code: "NOT_FOUND",
      message: "Route GET /nope not found.",
      requestId,
    });
  });

  test("CORS allows configured origins only", async () => {
    const server = await startServer();
    servers.push(server);
    const allowed = await fetch(`${server.url}/health`, { headers: { Origin: "http://localhost:3000" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    const denied = await fetch(`${server.url}/health`, { headers: { Origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("serves the OpenAPI spec and Swagger UI", async () => {
    const server = await startServer();
    servers.push(server);
    const spec = await (await fetch(`${server.url}/openapi.json`)).json();
    expect(spec.openapi).toStartWith("3.");
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/v1/audio/speech", "/v1/audio/transcriptions", "/v1/chat/completions", "/auth/login", "/api-keys"]),
    );
    expect(Object.keys(spec.components.securitySchemes)).toEqual(["bearerAuth", "cookieAuth"]);
    const docs = await fetch(`${server.url}/docs/`);
    expect(docs.status).toBe(200);
    expect(docs.headers.get("content-type")).toContain("text/html");
  });

  test("/v1/realtime is reserved and reports not implemented", async () => {
    const server = await startServer();
    servers.push(server);
    const res = await fetch(`${server.url}/v1/realtime`);
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("NOT_IMPLEMENTED");
  });
});
