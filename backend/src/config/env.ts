import "dotenv/config";
import { z } from "zod";

const dependency = z.enum(["database", "stt", "slm", "tts"]);

const boolFromString = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : undefined));

/** Optional URL; an empty value (e.g. "SLM_BASE_URL=" copied from .env.example) counts as unset. */
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url().optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    TRUST_PROXY: boolFromString.default(false),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/, "Use a duration like 15m, 12h or 7d").default("7d"),
    AUTH_COOKIE_NAME: z.string().min(1).default("auth_token"),
    // "none" is only needed for cross-site cookies (frontend and API on different sites); it forces Secure.
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

    CORS_ORIGINS: z.string().default("http://localhost:3000"),

    API_KEY_PREFIX: z.string().min(1).default("sk_live_"),

    MAX_JSON_BODY_BYTES: z.coerce.number().int().positive().default(1_000_000),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
    TTS_MAX_INPUT_CHARACTERS: z.coerce.number().int().positive().default(4000),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    // Every provider is a real model service; there is no mock mode.
    // STT: "groq" (hosted Whisper) or "http" (self-hosted Whisper worker).
    STT_PROVIDER: z.enum(["groq", "http"]).default("groq"),
    STT_SERVICE_URL: optionalUrl,
    STT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    GROQ_API_KEY: optionalString,
    GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
    GROQ_STT_MODEL: z.string().min(1).default("whisper-large-v3-turbo"),
    // Groq's documented direct-upload limit is 25 MB on the free tier (100 MB on the dev tier).
    GROQ_STT_MAX_FILE_BYTES: z.coerce.number().int().positive().default(25_000_000),

    // SLM: "http" (GPU worker, e.g. the Kaggle notebook) or "openai-compatible" (hosted fallback).
    SLM_PROVIDER: z.enum(["http", "openai-compatible"]).default("http"),
    SLM_SERVICE_URL: optionalUrl,
    SLM_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    SLM_BASE_URL: optionalUrl,
    SLM_API_KEY: optionalString,
    SLM_MODEL: optionalString,
    // How to ask an OpenAI-compatible host to skip thinking. "auto" picks "reasoning" for OpenRouter,
    // "chat_template_kwargs" (vLLM/SGLang style) otherwise. <think> blocks are always stripped regardless.
    SLM_DISABLE_THINKING: z.enum(["auto", "reasoning", "chat_template_kwargs", "none"]).default("auto"),

    // TTS: "http" (GPU worker, e.g. the Kaggle notebook).
    TTS_PROVIDER: z.enum(["http"]).default("http"),
    TTS_SERVICE_URL: optionalUrl,
    TTS_SERVICE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

    // Shared secret sent to self-hosted GPU workers as X-Worker-Key.
    WORKER_API_KEY: optionalString,

    // Which dependencies /ready must confirm. Lets a partial deployment (e.g. TTS only) report ready.
    READINESS_REQUIRED: z.string().default("database,stt,slm,tts"),
  })
  .superRefine((cfg, ctx) => {
    const require = (field: keyof typeof cfg, when: string) => {
      if (!cfg[field]) ctx.addIssue({ code: "custom", path: [field], message: `${field} is required when ${when}` });
    };
    if (cfg.STT_PROVIDER === "groq") require("GROQ_API_KEY", "STT_PROVIDER=groq");
    if (cfg.STT_PROVIDER === "http") require("STT_SERVICE_URL", "STT_PROVIDER=http");
    if (cfg.SLM_PROVIDER === "http") require("SLM_SERVICE_URL", "SLM_PROVIDER=http");
    if (cfg.TTS_PROVIDER === "http") require("TTS_SERVICE_URL", "TTS_PROVIDER=http");
    if (cfg.SLM_PROVIDER === "openai-compatible") {
      require("SLM_BASE_URL", "SLM_PROVIDER=openai-compatible");
      require("SLM_MODEL", "SLM_PROVIDER=openai-compatible");
    }
    const usesWorker = cfg.TTS_PROVIDER === "http" || cfg.SLM_PROVIDER === "http";
    if (usesWorker && cfg.NODE_ENV === "production") {
      if (!cfg.WORKER_API_KEY) {
        require("WORKER_API_KEY", "a GPU worker is used in production (TTS_PROVIDER=http or SLM_PROVIDER=http)");
      } else if (cfg.WORKER_API_KEY.length < 16) {
        ctx.addIssue({ code: "custom", path: ["WORKER_API_KEY"], message: "WORKER_API_KEY must be at least 16 characters" });
      }
    }
  });

/** The upload limit the transcription endpoint enforces: the provider's own limit wins when it is lower. */
export function effectiveUploadLimit(sttProvider: string, maxUploadBytes: number, groqMaxFileBytes: number): number {
  return sttProvider === "groq" ? Math.min(maxUploadBytes, groqMaxFileBytes) : maxUploadBytes;
}

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
  maxUploadBytes: effectiveUploadLimit(raw.STT_PROVIDER, raw.MAX_UPLOAD_BYTES, raw.GROQ_STT_MAX_FILE_BYTES),
  readinessRequired: raw.READINESS_REQUIRED.split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => dependency.parse(d)),
};

export type Env = typeof env;
