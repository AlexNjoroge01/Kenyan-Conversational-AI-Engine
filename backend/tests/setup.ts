// Runs before any test file. Must set env before src/config/env.ts is first imported.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/kenya_engine_test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-test-secret";
process.env.BCRYPT_COST = "4";
process.env.AUTH_RATE_LIMIT_MAX = "10000";
process.env.RATE_LIMIT_MAX = "10000";
process.env.STT_PROVIDER = "mock";
process.env.SLM_PROVIDER = "mock";
process.env.TTS_PROVIDER = "mock";
process.env.READINESS_REQUIRED = "database,stt,slm,tts";
process.env.MAX_UPLOAD_BYTES = "1048576";
process.env.TTS_MAX_INPUT_CHARACTERS = "500";
process.env.CORS_ORIGINS = "http://localhost:3000";

const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { db } = await import("../src/db/client");
await migrate(db, { migrationsFolder: "./src/db/migrations" });
