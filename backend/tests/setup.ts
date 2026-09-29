// Runs before any test file. Must set env before src/config/env.ts is first imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/kenya_engine_test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-test-secret";
process.env.BCRYPT_COST = "4";
process.env.AUTH_RATE_LIMIT_MAX = "10000";
process.env.RATE_LIMIT_MAX = "10000";
// A production-shaped provider configuration. Nothing here is reachable: the fetch guard below blocks non-local
// hosts and port 9 on localhost refuses connections, so tests inject fakes (tests/fakes.ts) or a mocked fetch.
process.env.STT_PROVIDER = "groq";
process.env.GROQ_API_KEY = "gsk_test_not_a_real_key";
process.env.SLM_PROVIDER = "http";
process.env.SLM_SERVICE_URL = "http://127.0.0.1:9";
process.env.TTS_PROVIDER = "http";
process.env.TTS_SERVICE_URL = "http://127.0.0.1:9";
process.env.WORKER_API_KEY = "test-worker-key-test-worker-key";
process.env.READINESS_REQUIRED = "database,stt,slm,tts";
process.env.MAX_UPLOAD_BYTES = "1048576";
process.env.TTS_MAX_INPUT_CHARACTERS = "500";
process.env.CORS_ORIGINS = "http://localhost:3000";
process.env.COOKIE_SAMESITE = "lax";
// Never let real credentials from a local .env reach the test process.
for (const name of ["SLM_BASE_URL", "SLM_API_KEY", "SLM_MODEL", "STT_SERVICE_URL", "HF_TOKEN"]) {
  delete process.env[name];
}

// Tests must never reach Groq, Hugging Face, ngrok or a Kaggle worker. Providers under test receive a
// mocked fetch; anything that slips through to the real network fails loudly instead.
const realFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      return Promise.reject(new Error(`Blocked outbound request to ${url.hostname} during tests`));
    }
    return realFetch(input, init);
  },
  { preconnect: realFetch.preconnect },
) as typeof fetch;

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { db } = await import("../src/db/client");
await migrate(db, { migrationsFolder: "./src/db/migrations" });
