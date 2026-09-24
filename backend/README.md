# Kenyan Conversational AI — MVP Backend

Express + TypeScript (Bun) API exposing speech-to-text, a small language model and text-to-speech tuned for English, Kiswahili and code-switching. The API only orchestrates: model inference runs in separate worker services (`../workers/*`), and each model sits behind a provider interface so it can be swapped without changing the public API.

| Endpoint | Model (public ID) | Purpose |
|---|---|---|
| `POST /v1/audio/transcriptions` | `whisper-large-v3-turbo` | speech → text |
| `POST /v1/chat/completions` | `qwen3.5-4b` | text → reply (structured JSON output supported) |
| `POST /v1/audio/speech` | `sauti-v2` | text → speech |
| `GET /health`, `GET /ready` | | liveness / dependency readiness |
| `/auth/*`, `/api-keys` | | account + API-key management (JWT cookie) |
| `/docs`, `/openapi.json` | | Swagger UI / OpenAPI spec |

`PipelineService` (`src/services/pipeline`) chains audio → STT → SLM → TTS → audio. It is internal only; there is no public route in the MVP. Streaming, realtime WebSocket, tool calling and billing are intentionally not built yet (`stream: true` returns `501 NOT_IMPLEMENTED`).

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- Docker (for PostgreSQL and optional containerised API)
- PostgreSQL 16 (provided by `docker-compose.yml`)
- **No GPU needed for development**: providers can be mocked (`*_PROVIDER=mock`). Real models need an NVIDIA GPU with the workers in `../workers` (Whisper large-v3-turbo ≈ 3 GB VRAM, Qwen3.5-4B ≈ 9 GB in bf16, Sauti/Chatterbox ≈ 6–8 GB — measure on your hardware).

## Quick start

```bash
bun install
cp .env.example .env          # then set JWT_SECRET (openssl rand -base64 48)
docker compose up -d postgres
bun run db:migrate
bun run dev                   # http://localhost:4000  (docs at /docs)
```

## Configuration

All configuration is environment-based and validated at startup (`src/config/env.ts`); the process exits with a clear message if it is invalid. See `.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `JWT_SECRET` (≥32 chars) | required |
| `JWT_EXPIRES_IN`, `AUTH_COOKIE_NAME`, `AUTH_COOKIE_SAMESITE` | session cookie (HttpOnly; `Secure` in production) |
| `CORS_ORIGINS` | comma-separated allow-list (default `http://localhost:3000`) |
| `API_KEY_PREFIX` | default `sk_live_` |
| `STT_/SLM_/TTS_PROVIDER` | `mock` or `http` |
| `*_SERVICE_URL`, `*_SERVICE_TIMEOUT_MS` | worker addresses and timeouts |
| `READINESS_REQUIRED` | dependencies `/ready` must confirm, e.g. `database,tts` for a TTS-only deployment |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX` | in-memory rate limits (per API key / per IP) |
| `TRUST_PROXY` | set `true` behind a load balancer |
| `HF_TOKEN` | Hugging Face token used by the GPU workers |

### Database

Schema lives in `src/db/schema`; migrations in `src/db/migrations`.

```bash
bunx drizzle-kit generate     # after changing the schema
bun run db:migrate            # apply migrations
```

## Authentication and first API call

1. Create an account (sets an HTTP-only cookie):
   ```bash
   curl -c cookies.txt -H 'Content-Type: application/json' \
     -d '{"email":"developer@example.com","password":"strong-password"}' \
     http://localhost:4000/auth/register
   ```
2. Create an API key (the full key is shown **once**; only its hash is stored):
   ```bash
   curl -b cookies.txt -H 'Content-Type: application/json' \
     -d '{"name":"Local Development"}' http://localhost:4000/api-keys
   ```
3. Generate speech:
   ```bash
   curl http://localhost:4000/v1/audio/speech \
     -H "Authorization: Bearer sk_live_xxxxxxxxx" \
     -H "Content-Type: application/json" \
     -d '{"model":"sauti-v2","input":"Habari, karibu Kenya.","voice":"default","response_format":"mp3"}' \
     --output speech.mp3
   ```
   With `TTS_PROVIDER=mock` the audio is a short WAV tone (the mock cannot encode MP3, and says so in `Content-Type`).
4. Transcribe and chat:
   ```bash
   curl http://localhost:4000/v1/audio/transcriptions -H "Authorization: Bearer $KEY" \
     -F file=@clip.wav -F model=whisper-large-v3-turbo -F language=sw

   curl http://localhost:4000/v1/chat/completions -H "Authorization: Bearer $KEY" \
     -H 'Content-Type: application/json' \
     -d '{"model":"qwen3.5-4b","messages":[{"role":"user","content":"Nataka kujua status ya order yangu."}]}'
   ```

In Swagger UI (`/docs`) call `/auth/login`, then **Authorize** with your API key under `bearerAuth` to try the `/v1/*` endpoints.

Every response has an `X-Request-ID` header. Errors are always:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.", "requestId": "req_123" } }
```

## Architecture

```
Client ──► Express API ──► middleware (request ID, CORS, auth, rate limit, Zod validation)
              │
              ▼
        routes → controllers → services ──► repositories ──► PostgreSQL (users, api_keys, usage_events)
                                  │
                                  ├─► SttProvider ─► WhisperSttProvider ─► stt-worker (POST /transcribe)
                                  ├─► SlmProvider ─► QwenSlmProvider    ─► slm-worker (POST /complete)
                                  └─► TtsProvider ─► SautiTtsProvider   ─► tts-worker (POST /synthesize)
```

Each request writes one `usage_events` row (endpoint, model, status, duration, input characters, audio duration, error code). Logs are structured JSON (pino) and never contain credentials.

## Tests

```bash
docker compose up -d postgres   # creates kenya_engine_test on first start
bun test
bun run typecheck
```

Tests use a real PostgreSQL database and mocked/fake model providers; no GPU is required. If your Postgres volume pre-dates `docker/init-test-db.sql`, create the DB once: `docker compose exec postgres createdb -U postgres kenya_engine_test`.

## Docker

```bash
docker compose up --build api postgres     # API + DB with mocked models (needs JWT_SECRET in .env)
docker compose --profile gpu up --build    # also builds/starts the real workers (NVIDIA GPU + container toolkit)
```

The API image contains no models and applies migrations on start. Workers download models from Hugging Face on first start (cached in the `hf-cache` volume); set `HF_TOKEN` in `.env` if a repo is gated.

## Production

```bash
bun install --frozen-lockfile --production
NODE_ENV=production bun run db:migrate && NODE_ENV=production bun src/server.ts
```

Run behind HTTPS, set `TRUST_PROXY=true`, use a strong `JWT_SECRET` from a secrets manager, and restrict `CORS_ORIGINS`.

## Worker status

- `stt-worker` (faster-whisper) and `slm-worker` (transformers) are straightforward but **untested** (no GPU was available).
- `tts-worker` **cannot serve Sauti V2 yet**: the model is a LoRA adapter that must be applied to Chatterbox with its fine-tuning toolkit; `load_adapter` in `../workers/tts-worker/app.py` is a marked TODO to finish on a GPU machine. Until then use `SAUTI_APPLY_ADAPTER=false` (plain Chatterbox) or the mock provider.

## Troubleshooting

| Symptom | Check |
|---|---|
| Exits at startup with "Invalid environment configuration" | missing `DATABASE_URL` / short `JWT_SECRET` |
| `/ready` → 503, `database: unavailable` | `docker compose ps`; verify `DATABASE_URL` |
| `503 TTS_UNAVAILABLE` (or `STT_`/`SLM_`) | worker down/timeout: `curl $TTS_SERVICE_URL/health`; raise `*_SERVICE_TIMEOUT_MS` during cold starts |
| `401 API_KEY_INVALID` / `API_KEY_REVOKED` | key mistyped, or revoked via `DELETE /api-keys/:id` — create a new one |
| `404 MODEL_NOT_FOUND` | use the public IDs above, not Hugging Face names |
| Worker OOM / won't start | check `nvidia-smi`; run one worker per GPU or a smaller compute type |
