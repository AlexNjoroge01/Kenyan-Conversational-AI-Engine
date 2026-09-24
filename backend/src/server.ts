import { createApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { createProvidersFromEnv, createServices } from "./services/container";
import { logger } from "./utils/logger";

const app = createApp(createServices(createProvidersFromEnv()));

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, providers: { stt: env.STT_PROVIDER, slm: env.SLM_PROVIDER, tts: env.TTS_PROVIDER } },
    "API listening",
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(async () => {
    await pool.end().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
