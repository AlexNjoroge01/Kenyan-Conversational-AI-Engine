import { describe, expect, spyOn, test } from "bun:test";
import { parse } from "pg-connection-string";
import { effectiveUploadLimit } from "../src/config/env";
import { normalizeDatabaseUrl } from "../src/db/connection-string";
import { authCookieOptions } from "../src/utils/cookies";

/**
 * Loads src/config/env.ts in a fresh process with exactly the given variables: no inherited environment,
 * no .env file (bun --no-env-file, and dotenv pointed at a file that does not exist).
 */
async function loadEnv(vars: Record<string, string>) {
  const proc = Bun.spawn(["bun", "--no-env-file", "-e", 'await import("./src/config/env.ts"); console.log("ENV_OK")'], {
    cwd: `${import.meta.dir}/..`,
    env: {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      DOTENV_CONFIG_PATH: "./does-not-exist.env",
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      JWT_SECRET: "x".repeat(40),
      STT_PROVIDER: "mock",
      SLM_PROVIDER: "mock",
      TTS_PROVIDER: "mock",
      ...vars,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { ok: code === 0 && stdout.includes("ENV_OK"), output: stdout + stderr };
}

describe("environment validation", () => {
  test("accepts the all-mock configuration", async () => {
    expect((await loadEnv({})).ok).toBe(true);
  });

  test("STT_PROVIDER=groq requires GROQ_API_KEY", async () => {
    const missing = await loadEnv({ STT_PROVIDER: "groq" });
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("GROQ_API_KEY is required when STT_PROVIDER=groq");
    expect((await loadEnv({ STT_PROVIDER: "groq", GROQ_API_KEY: "gsk_test" })).ok).toBe(true);
  });

  test("SLM_PROVIDER=openai-compatible requires SLM_BASE_URL and SLM_MODEL", async () => {
    const missing = await loadEnv({ SLM_PROVIDER: "openai-compatible" });
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("SLM_BASE_URL is required");
    expect(missing.output).toContain("SLM_MODEL is required");
    const ok = await loadEnv({
      SLM_PROVIDER: "openai-compatible",
      SLM_BASE_URL: "https://openrouter.ai/api/v1",
      SLM_MODEL: "qwen/qwen3.5-9b",
    });
    expect(ok.ok).toBe(true);
  });

  test("a production GPU worker requires a WORKER_API_KEY of at least 16 characters", async () => {
    const prod = { NODE_ENV: "production", TTS_PROVIDER: "http", TTS_SERVICE_URL: "https://worker.example.com" };
    const missing = await loadEnv(prod);
    expect(missing.ok).toBe(false);
    expect(missing.output).toContain("WORKER_API_KEY is required");
    const short = await loadEnv({ ...prod, WORKER_API_KEY: "short" });
    expect(short.output).toContain("at least 16 characters");
    expect((await loadEnv({ ...prod, WORKER_API_KEY: "k".repeat(32) })).ok).toBe(true);
  });

  test("rejects an unknown COOKIE_SAMESITE value", async () => {
    const res = await loadEnv({ COOKIE_SAMESITE: "sometimes" });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("COOKIE_SAMESITE");
  });

  test("accepts a Neon-style DATABASE_URL with sslmode=verify-full, without warnings", async () => {
    const res = await loadEnv({
      DATABASE_URL: "postgresql://user:pass@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require",
    });
    expect(res.ok).toBe(true);
    expect(res.output).not.toContain("WARNING");
  });
});

describe("transcription upload limit", () => {
  test("Groq's 25 MB limit applies when it is lower than MAX_UPLOAD_BYTES", () => {
    expect(effectiveUploadLimit("groq", 26_214_400, 25_000_000)).toBe(25_000_000);
    expect(effectiveUploadLimit("groq", 10_000_000, 25_000_000)).toBe(10_000_000);
    expect(effectiveUploadLimit("http", 26_214_400, 25_000_000)).toBe(26_214_400);
  });
});

describe("auth cookie options", () => {
  test("SameSite=None always forces Secure", () => {
    expect(authCookieOptions("none", false)).toMatchObject({ sameSite: "none", secure: true, httpOnly: true });
    expect(authCookieOptions("none", true)).toMatchObject({ sameSite: "none", secure: true });
  });

  test("lax/strict are Secure only in production", () => {
    expect(authCookieOptions("lax", false)).toMatchObject({ sameSite: "lax", secure: false, httpOnly: true });
    expect(authCookieOptions("lax", true)).toMatchObject({ sameSite: "lax", secure: true });
    expect(authCookieOptions("strict", true)).toMatchObject({ sameSite: "strict", secure: true });
  });
});

describe("DATABASE_URL normalisation", () => {
  const neon = "postgresql://user:pass@ep-x.eu-central-1.aws.neon.tech/neondb";

  test("keeps sslmode=verify-full as is", () => {
    const url = `${neon}?sslmode=verify-full&channel_binding=require`;
    expect(normalizeDatabaseUrl(url)).toBe(url);
  });

  test.each(["require", "prefer", "verify-ca"])("rewrites the legacy alias sslmode=%s to verify-full", (mode) => {
    const out = new URL(normalizeDatabaseUrl(`${neon}?sslmode=${mode}&channel_binding=require`));
    expect(out.searchParams.get("sslmode")).toBe("verify-full");
    expect(out.searchParams.get("channel_binding")).toBe("require");
  });

  test("leaves disable, no sslmode, and libpq-compat URLs untouched", () => {
    for (const url of [`${neon}?sslmode=disable`, neon, `${neon}?uselibpqcompat=true&sslmode=require`, "not a url"]) {
      expect(normalizeDatabaseUrl(url)).toBe(url);
    }
  });

  test("node-postgres parses the normalised URL with TLS verification and no security warning", () => {
    const warn = spyOn(process, "emitWarning");
    try {
      for (const mode of ["verify-full", "require"]) {
        const config = parse(normalizeDatabaseUrl(`${neon}?sslmode=${mode}`));
        expect(config.ssl).toBeTruthy();
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
