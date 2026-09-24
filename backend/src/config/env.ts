import "dotenv/config";
import { z } from "zod";

const providerMode = z.enum(["http", "mock"]);
const dependency = z.enum(["database", "stt", "slm", "tts"]);

const boolFromString = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TRUST_PROXY: boolFromString.default(false),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, "Use a duration like 15m, 12h or 7d").default("7d"),
  AUTH_COOKIE_NAME: z.string().min(1).default("auth_token"),
  AUTH_COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  API_KEY_PREFIX: z.string().min(1).default("sk_live_"),

  MAX_JSON_BODY_BYTES: z.coerce.number().int().positive().default(1_000_000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  TTS_MAX_INPUT_CHARACTERS: z.coerce.number().int().positive().default(4000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  STT_PROVIDER: providerMode.default("http"),
  STT_SERVICE_URL: z.string().url().default("http://localhost:8001"),
  STT_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  SLM_PROVIDER: providerMode.default("http"),
  SLM_SERVICE_URL: z.string().url().default("http://localhost:8002"),
  SLM_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  TTS_PROVIDER: providerMode.default("http"),
  TTS_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  TTS_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Which dependencies /ready must confirm. Lets a partial deployment (e.g. TTS only) report ready.
  READINESS_REQUIRED: z.string().default("database,stt,slm,tts"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  corsOrigins: raw.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
  readinessRequired: raw.READINESS_REQUIRED.split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => dependency.parse(d)),
};

export type Env = typeof env;
