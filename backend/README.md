# Kenyan Conversational AI — MVP Backend

An Express + TypeScript (Bun) API that exposes three services, tuned for Kenyan English, Kiswahili and English–Kiswahili code-switching:

- speech-to-text
- a small language model
- text-to-speech

The API only orchestrates: model inference runs elsewhere. Each model sits behind a provider interface, so implementations can change without changing the public API.

| Endpoint | Public model ID | Purpose | Backed by (production) |
|---|---|---|---|
| `POST /v1/audio/transcriptions` | `whisper-large-v3-turbo` | speech → text | Groq (hosted Whisper Large V3 Turbo) |
| `POST /v1/chat/completions` | `qwen3.5-4b` | text → reply (JSON mode supported) | Qwen3.5-4B on the Kaggle GPU worker; hosted fallback available |
| `POST /v1/audio/speech` | `sauti-v2` | text → speech | Sauti V2 (Chatterbox + LoRA) on the Kaggle GPU worker |
| `GET /` | | service name, version, docs link | |
| `GET /health`, `GET /ready` | | liveness / reachability of the database and each model service | |
| `/auth/*`, `/api-keys` | | account and API-key management (JWT cookie) | |
| `/docs`, `/openapi.json` | | Swagger UI / OpenAPI spec | |

Public model IDs never change with the provider. Groq, Hugging Face, OpenRouter, ngrok and worker details are never exposed to clients, whether in responses, error messages or `/ready`.

`PipelineService` (`src/services/pipeline`) chains audio → STT → SLM → TTS → audio. It is internal only; there is no public route in the MVP. Streaming, the realtime WebSocket, tool calling and billing are not built yet (`stream: true` returns `501 NOT_IMPLEMENTED`).

## Architecture

```
Browser ──► Vercel (Next.js, later) ──/api/* rewrite──► Render: Express API ──► Neon PostgreSQL
                                                             │
          middleware (request ID, CORS, auth, rate limit, Zod) → routes → controllers → services
                                                             │
                     ┌───────────────────────────────────────┼─────────────────────────────────────┐
                     ▼                                       ▼                                     ▼
        SttProvider                              SlmProvider                          TtsProvider
          ├─ GroqSttProvider ──► Groq API          ├─ QwenSlmProvider ──┐               └─ SautiTtsProvider ──┐
          └─ WhisperSttProvider (self-hosted)      └─ OpenAiCompatible  │                                     │
                                                       SlmProvider ──► OpenRouter / HF                        │
                                                                        ▼                                    ▼
                                         https://<NGROK_DOMAIN> ──► Kaggle notebook (GPU T4 ×2), X-Worker-Key
                                                                     ├─ POST /complete    Qwen3.5-4B   cuda:1
                                                                     └─ POST /synthesize  Sauti V2     cuda:0
```

The dependency direction is strict: middleware → routes → controllers → services → providers/repositories. All remote calls go through `src/services/provider-http.ts`, which:
- applies timeouts;
- maps provider errors to our error codes;
- never reads provider error bodies into responses or logs;
- caches health checks for about 10 seconds.

The GPU worker is `../workers/kaggle/kenya_engine_worker.ipynb`; see [`../workers/kaggle/README.md`](../workers/kaggle/README.md).

## Design decisions

The choices behind the current setup, with the reasoning, so they aren't undone by accident.

| Decision | Why |
|---|---|
| **No mock mode.** The API only runs against real model services; `*_PROVIDER=mock` is rejected at startup, and service URLs must be set explicitly (no localhost defaults) | A deployment left on mock providers served canned replies (a fixed transcript, a fixed chat answer, a tone instead of speech), and `/ready` still showed green. Real providers only means a misconfiguration fails loudly at boot, and `/ready` reports the truth |
| **Automated tests use test-only fakes** (`tests/fakes.ts`) and mocked `fetch` | The test suite must not spend Groq quota or need the GPU notebook online. The fakes live only in `tests/`; application code can't reach them |
| **STT on Groq** (Whisper Large V3 Turbo) | Same model as the spec, hosted, fast, with a free tier. It frees the T4 GPUs for the two models that have no hosted option |
| **SLM and TTS on one Kaggle notebook** (2× T4: Sauti on `cuda:0` fp32, Qwen on `cuda:1` fp16, 8K context), exposed over ngrok with a shared `X-Worker-Key` | The only free GPU option available. One notebook serves both models so they share one tunnel and one URL. fp16 because the T4 has no fast bf16. The 8K context cap keeps Qwen (≈9.3 GB of weights) within a T4's ~15 GB |
| **Sauti V2 loaded the way the fine-tuning toolkit does** (resize T3 to 2,454 tokens → PEFT LoRA → merge), with a check that the adapter really applied | The public reference Space fails, falls back silently, and serves the base English model. The notebook refuses to serve TTS rather than serve the wrong voice |
| **Model weights download from Hugging Face by default; the Kaggle weights bundle is an optional cache** | Downloading needs no setup and always gets the exact pinned revisions, so it's the safest path for a first run. The cache (`export_weights.ipynb`, attached with *Add Input*) only saves the 5–10 minutes of GPU quota each start costs. The worker uses a bundle only if its revisions match and every file is present, and otherwise downloads, so the cache can make startup faster but never break it. Get the plain download working first, then add the cache |
| **Pinned model revisions** in both notebooks | Reproducible deployments (spec §9). A model update upstream can't change behaviour silently |
| **Hosted SLM fallback: OpenRouter `qwen/qwen3.5-9b`** (optional) | No hosted provider serves Qwen3.5-4B (checked 29 Sep 2026); the 9B is the nearest sibling. Clients still see `qwen3.5-4b`, so benchmark it before relying on it |
| **Provider errors mapped to stable codes; bodies, keys and URLs never exposed** | Clients get `*_UNAVAILABLE` / `*_FAILED` / `RATE_LIMITED`; Groq, ngrok and Kaggle details stay internal (Blueprint §12–13) |
| **Frontend through a same-origin `/api` rewrite on Vercel** | The session cookie stays first-party (`SameSite=Lax`), so third-party-cookie blocking can't break login, and no CORS is needed |

## Requirements

- [Bun](https://bun.sh) ≥ 1.3
- PostgreSQL 16+ (Docker Compose provides one; Neon in production)
- **No GPU on the API machine.** Models run on Groq and the Kaggle notebook. **There is no mock mode:** every environment, local included, talks to the real model services.
- A Groq API key, and the Kaggle notebook running for chat and speech (see [Deployment](#deployment)).

## Quick start (local, real models)

```bash
bun install
cp .env.example .env          # set JWT_SECRET (openssl rand -base64 48), GROQ_API_KEY,
                              # SLM_SERVICE_URL + TTS_SERVICE_URL (your ngrok domain) and WORKER_API_KEY
docker compose up -d postgres
bun run db:migrate
bun run dev                   # http://localhost:4000  (docs at /docs)
```

## Configuration

All configuration comes from the environment and is validated at startup (`src/config/env.ts`). The process exits with a clear message when something is missing, for example `GROQ_API_KEY is required when STT_PROVIDER=groq`. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | Postgres URL. Neon's `sslmode=verify-full` works as issued; the legacy aliases `require`/`prefer`/`verify-ca` are normalised to `verify-full` (same behaviour, no pg warning) |
| `JWT_SECRET` | required (≥32 chars) | session signing |
| `JWT_EXPIRES_IN`, `AUTH_COOKIE_NAME` | `7d`, `auth_token` | session cookie (HttpOnly) |
| `COOKIE_SAMESITE` | `lax` | `lax` \| `strict` \| `none`. `none` is only for cross-site cookies and always forces `Secure`. Other values are `Secure` in production |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated allow-list (credentials enabled) |
| `TRUST_PROXY` | `false` | `true` behind Render / any load balancer |
| `STT_PROVIDER` | `groq` | `groq` \| `http` (self-hosted Whisper worker) |
| `GROQ_API_KEY` | — | required when `STT_PROVIDER=groq` |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` | Groq's model ID (internal) |
| `GROQ_STT_MAX_FILE_BYTES` | `25000000` | Groq's free-tier upload limit (25 MB; 100 MB on the dev tier). Uploads are capped at the lower of this and `MAX_UPLOAD_BYTES` |
| `STT_TIMEOUT_MS` | `60000` | STT request timeout |
| `STT_SERVICE_URL` | — | self-hosted Whisper worker; required when `STT_PROVIDER=http` |
| `SLM_PROVIDER` | `http` | `http` (GPU worker) \| `openai-compatible` (hosted fallback) |
| `SLM_SERVICE_URL`, `SLM_SERVICE_TIMEOUT_MS` | —, `120000` | GPU worker (your ngrok domain); URL required when `SLM_PROVIDER=http` |
| `SLM_BASE_URL`, `SLM_API_KEY`, `SLM_MODEL` | — | fallback host, e.g. `https://openrouter.ai/api/v1`, `qwen/qwen3.5-9b` |
| `SLM_DISABLE_THINKING` | `auto` | how thinking is switched off on the fallback: `reasoning` (OpenRouter), `chat_template_kwargs` (vLLM/SGLang/HF), `none`. `auto` picks by host |
| `TTS_PROVIDER` | `http` | `http` (GPU worker) |
| `TTS_SERVICE_URL`, `TTS_SERVICE_TIMEOUT_MS` | —, `120000` | GPU worker (same ngrok domain as the SLM); URL required |
| `WORKER_API_KEY` | — | shared secret sent to the GPU worker as `X-Worker-Key`. **Required (≥16 chars) in production** when `TTS_PROVIDER` or `SLM_PROVIDER` is `http` |
| `TTS_MAX_INPUT_CHARACTERS` | `4000` | keep at or below the worker's `TTS_MAX_CHARS` (1000) |
| `MAX_UPLOAD_BYTES`, `MAX_JSON_BODY_BYTES` | 25 MiB, 1 MB | request size limits |
| `READINESS_REQUIRED` | `database,stt,slm,tts` | which dependencies `/ready` must confirm |
| `RATE_LIMIT_*`, `AUTH_RATE_LIMIT_MAX` | | in-memory rate limits (per API key / per IP) |
| `HF_TOKEN` | — | only for the local Docker GPU workers |

Renamed in this version: `AUTH_COOKIE_SAMESITE` → `COOKIE_SAMESITE`, and `STT_SERVICE_TIMEOUT_MS` → `STT_TIMEOUT_MS`. The old names are ignored.

Every GPU-worker call carries `X-Worker-Key` and `ngrok-skip-browser-warning: true`. The TTS and SLM providers can point at the same base URL (the Kaggle notebook serves both).

### Database

Schema lives in `src/db/schema` and migrations in `src/db/migrations`. The Docker image applies migrations on start.

```bash
bunx drizzle-kit generate     # after changing the schema
bun run db:migrate            # apply migrations
```

## Using the API

Replace `$API` with `http://localhost:4000` or `https://kenyan-conversational-ai-engine.onrender.com`.

1. Create an account. This sets an HTTP-only session cookie:
   ```bash
   curl -c cookies.txt -H 'Content-Type: application/json' \
     -d '{"email":"developer@example.com","password":"strong-password"}' \
     $API/auth/register
   ```
2. Create an API key. The full key is shown **once**; only its hash is stored:
   ```bash
   curl -b cookies.txt -H 'Content-Type: application/json' -d '{"name":"Local Development"}' $API/api-keys
   export KEY=sk_live_xxxxxxxxx
   ```
3. **Speech to text.** Multipart; `language` is optional (ISO 639-1, e.g. `sw`, `en`). Formats: wav, mp3, m4a, ogg, webm, flac, mp4. The limit is 25 MB with Groq.
   ```bash
   curl $API/v1/audio/transcriptions -H "Authorization: Bearer $KEY" \
     -F file=@clip.wav -F model=whisper-large-v3-turbo -F language=sw
   # {"text":"Nataka kujua status ya order yangu.","model":"whisper-large-v3-turbo","language":"sw"}
   ```
4. **Chat.** OpenAI-style. Send history in `messages`. Use `response_format: {"type":"json_object"}` for JSON:
   ```bash
   curl $API/v1/chat/completions -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"model":"qwen3.5-4b","messages":[
           {"role":"system","content":"Wewe ni msaidizi wa huduma kwa wateja. Jibu kwa ufupi."},
           {"role":"user","content":"Nataka kujua status ya order yangu."}],
         "max_tokens":200}'
   # {"id":"chat_…","object":"chat.completion","model":"qwen3.5-4b","choices":[{"index":0,"message":{"role":"assistant","content":"…"},"finish_reason":"stop"}]}
   ```
5. **Text to speech.** The response body is the audio. Trust `Content-Type`: WAV is returned if the worker cannot encode MP3:
   ```bash
   curl $API/v1/audio/speech -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"model":"sauti-v2","input":"Nimefika office, I will call you nikimaliza meeting.","voice":"default","response_format":"wav"}' \
     --output speech.wav
   ```
   Generation on a T4 is slow: allow up to about two minutes for long inputs.

In Swagger UI (`/docs`), call `/auth/login`, then click **Authorize** and paste your API key under `bearerAuth` to try the `/v1/*` endpoints.

Every response has an `X-Request-ID` header, and every `/v1/*` call (including failed ones) writes a `usage_events` row with:
- endpoint and public model ID
- status and duration
- input characters
- audio duration (TTS output, or STT input when the provider reports it)
- error code

### Errors

Errors always look like:

```json
{ "error": { "code": "TTS_UNAVAILABLE", "message": "The text-to-speech service is currently unavailable.", "requestId": "req_123" } }
```

Model-service failures map to stable codes. Provider error bodies, keys and URLs are never forwarded or logged; only the provider name and HTTP status are logged.

| What happened upstream | Status → code |
|---|---|
| timeout, connection refused, DNS failure, offline ngrok tunnel (404), 502/503/504, model not loaded, GPU out of memory | 503 `STT_UNAVAILABLE` / `SLM_UNAVAILABLE` / `TTS_UNAVAILABLE` |
| 401/403 (our Groq key or `WORKER_API_KEY` is wrong) | 503 `*_UNAVAILABLE` (logged as an error: "rejected our credentials") |
| 429 | 429 `RATE_LIMITED`, with `Retry-After` (capped at 120 s) when the provider sent one |
| 413 (input too large or conversation over the 8K context) | 413 `PAYLOAD_TOO_LARGE` |
| 400/422 (input rejected) | 422 `STT_TRANSCRIPTION_FAILED` / `SLM_COMPLETION_FAILED` / `TTS_GENERATION_FAILED` |
| 500, or a malformed, empty or non-audio 200 response | 502 `*_FAILED` |

The SLM strips `<think>…</think>` reasoning from every reply, whichever provider served it. Thinking is also disabled upstream (`enable_thinking=False` on the worker; `reasoning`/`chat_template_kwargs` on the fallback).

## Deployment

Current setup:
- **API:** Render free web service (Docker, Frankfurt)
- **Database:** Neon free
- **STT:** Groq
- **SLM and TTS:** the Kaggle notebook, reached over ngrok
- **Frontend:** Next.js on Vercel (next phase)

### Render environment

Set these in Render → Environment. Values shown are examples; never commit real secrets. Render sets `PORT` itself.

| Variable | Example |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |
| `DATABASE_URL` | `postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require` |
| `JWT_SECRET` | output of `openssl rand -base64 48` |
| `COOKIE_SAMESITE` | `lax` (with the Next.js rewrite proxy) |
| `CORS_ORIGINS` | `https://your-app.vercel.app,http://localhost:3000` |
| `STT_PROVIDER` | `groq` |
| `GROQ_API_KEY` | `gsk_…` |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` |
| `STT_TIMEOUT_MS` | `60000` |
| `SLM_PROVIDER` | `http` |
| `SLM_SERVICE_URL` | `https://your-domain.ngrok-free.app` |
| `SLM_SERVICE_TIMEOUT_MS` | `120000` |
| `TTS_PROVIDER` | `http` |
| `TTS_SERVICE_URL` | `https://your-domain.ngrok-free.app` |
| `TTS_SERVICE_TIMEOUT_MS` | `120000` |
| `TTS_MAX_INPUT_CHARACTERS` | `500` (tune from the notebook's smoke-test real-time factor) |
| `WORKER_API_KEY` | the same value as the Kaggle secret `WORKER_API_KEY` |
| `READINESS_REQUIRED` | `database,stt,slm,tts` |

Set Render's **Health Check Path** to `/` (or `/health`), **not** `/ready`: `/ready` returns 503 whenever the Kaggle notebook is off, and Render would treat the API as down.

If you previously set `AUTH_COOKIE_SAMESITE` or `STT_SERVICE_TIMEOUT_MS`, rename them as above.

### Bring-up and end-to-end testing

Order matters: **Kaggle first, then check Render, then the frontend.** Each step checks one layer, so when something fails you know which layer to look at.

**Step 1: start the GPU worker on Kaggle** ([full guide](../workers/kaggle/README.md))
1. Import `workers/kaggle/kenya_engine_worker.ipynb` (**File → Import Notebook**). Settings: **GPU T4 x2**, **Internet On**. Attach the four secrets (`HF_TOKEN`, `NGROK_TOKEN`, `NGROK_DOMAIN`, `WORKER_API_KEY`).
2. **Don't attach a weights bundle for the first run**: let it download from Hugging Face (the default, see [Design decisions](#design-decisions)).
3. **Run All** and wait. The first run downloads ~13 GB, so allow about 15–25 minutes. Check for:
   - **Cell 1:** `OK: all secrets present`
   - **Cell 4:** `Sauti V2 ready on cuda:0`
   - **Cell 5:** `Qwen3.5-4B loaded as Qwen3_5ForCausalLM`
   - **Cell 7:** public `/health: 200`
   - **Cell 8:** `PASS` for the three TTS sentences, the chat turn and the auth check. Play `/kaggle/working/smoke_*.wav` from the file browser.
4. From your machine: `curl https://<NGROK_DOMAIN>/health` → `{"status":"ok","models":{"tts":true,"slm":true}}`.

If a cell fails, stop there and keep its output: that's the thing to fix. The API can't work around a worker that didn't load.

**Step 2: check the API on Render**
1. Make sure the deployed code is the latest commit (**Render → Events** shows the deployed commit) and the environment matches [Render environment](#render-environment). If the env is wrong, the service logs `Invalid environment configuration`, naming the variable, and doesn't start.
2. Check readiness:
   ```bash
   API=https://kenyan-conversational-ai-engine.onrender.com
   curl $API/          # {"name":"Kenyan Conversational AI API","version":"1.1.0",...}
   curl $API/ready     # {"status":"ready","dependencies":{"database":"ok","stt":"ok","slm":"ok","tts":"ok"}}
   ```
   `/ready` now checks the real services, so each `unavailable` points at a layer:
   - `stt`: the Groq key
   - `slm`/`tts`: the Kaggle notebook, the ngrok URL, or `WORKER_API_KEY`
   - `database`: Neon

   The free Render instance sleeps: the first call after idling can take ~1 minute.
3. Optional, with curl: register → create an API key → call the three `/v1` endpoints ([Using the API](#using-the-api)).

**Step 3: test from the frontend (Vercel)**
1. Confirm `CORS_ORIGINS` on Render includes your Vercel domain. The `/api` rewrite doesn't strictly need it, but it keeps the cross-site fallback working.
2. Sign up (or log in) → **API keys** → create a key → *Use in playground*.
3. **Speech to text:** record yourself saying something specific, e.g. *"Leo ni Jumanne, I will be in Nairobi."*. The transcript must match what you said, not a fixed sentence.
4. **Chat:** ask something open-ended in Kiswahili/English. The reply must respond to what you typed and contain no `<think>`.
5. **Text to speech:** *"Nimefika office, I will call you nikimaliza meeting."* You should hear speech, not a tone. Expect several seconds to a minute on the T4.
6. **Voice turn:** record → transcript → reply → spoken reply.
7. **Offline behaviour:** stop the Kaggle notebook and retry chat and speech. You should get a clear "service offline" message (`503 SLM_UNAVAILABLE` / `TTS_UNAVAILABLE`) within seconds, while STT keeps working.
8. Optional: in Neon, `select endpoint, model, status, error_code, duration_ms from usage_events order by created_at desc limit 20;` should show one row per call.

**Step 4: keep it running**
- For longer sessions, stop the interactive session and use **Save Version → Save & Run All (Commit)**. Only one session can hold the ngrok domain at a time.
- Once Step 1 works reliably, set up the optional [weights cache](../workers/kaggle/README.md#cache-the-weights-skip-the-13-gb-download) to cut 5–10 minutes (of GPU quota) from every start.

When Kaggle is off, chat and speech return `503 *_UNAVAILABLE` and never hang. To keep chat available, switch to the hosted fallback below. TTS has no hosted fallback: speech is unavailable until the notebook is running again.

### Hosted SLM fallback

**No hosted provider currently serves Qwen3.5-4B** (checked 29 Sep 2026):
- Hugging Face Inference Providers lists only `featherless-ai` for it, with status `error`.
- OpenRouter doesn't list it.

The nearest option is **Qwen3.5-9B**, the same family and chat template:

| Host | `SLM_BASE_URL` | `SLM_MODEL` | Price (per 1M tokens, in/out) |
|---|---|---|---|
| **OpenRouter** (recommended) | `https://openrouter.ai/api/v1` | `qwen/qwen3.5-9b` | about $0.10 / $0.15 (DeepInfra, SiliconFlow, Venice, Parasail…) |
| Hugging Face Inference Providers | `https://router.huggingface.co/v1` | `Qwen/Qwen3.5-9B:deepinfra` (or `:together`, `:ovhcloud`) | about $0.10 / $0.15 (deepinfra) |

```bash
SLM_PROVIDER=openai-compatible
SLM_BASE_URL=https://openrouter.ai/api/v1
SLM_API_KEY=sk-or-...
SLM_MODEL=qwen/qwen3.5-9b
SLM_DISABLE_THINKING=auto       # sends reasoning: {enabled: false} to OpenRouter
```

OpenRouter is recommended for three reasons:
- It documents a way to disable thinking (`reasoning.enabled=false`).
- It fails over across several providers.
- It uses one API key.

Clients still see the public ID `qwen3.5-4b` while the fallback serves the 9B model. That keeps the contract stable, but it is a different model: benchmark it before relying on it.

### Frontend (Next.js on Vercel) and cookies

**Preferred: same-origin through a rewrite proxy.** The browser only talks to the Vercel domain, and Vercel forwards `/api/*` to Render. The auth cookie is then first-party (`COOKIE_SAMESITE=lax`), which third-party-cookie blocking can't break, and the browser needs no CORS:

```js
// next.config.js
module.exports = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: "https://kenyan-conversational-ai-engine.onrender.com/:path*" }];
  },
};
// frontend code: fetch("/api/auth/login", { method: "POST", ... })
```

Keep `TRUST_PROXY=true` so per-IP rate limits use the forwarded client IP. Long TTS requests pass through Vercel's proxy, so check its timeout for rewrites on your plan.

**Alternative: cross-site cookies.** The browser calls Render directly:
- set `COOKIE_SAMESITE=none` (the cookie becomes `Secure` automatically);
- add the Vercel origin to `CORS_ORIGINS`;
- use `fetch(url, { credentials: "include" })`.

Browsers that block third-party cookies (Safari, and Chrome with tracking protection) may drop the session, which is why the proxy is preferred.

## Tests

```bash
docker compose up -d postgres   # creates kenya_engine_test on first start
bun test
bun run typecheck
```

Tests use a real PostgreSQL and **never touch the network**:
- The application has no mock mode. Tests inject **test-only** in-memory fakes (`tests/fakes.ts`) for the HTTP, auth, validation and usage-logging tests, so they don't spend Groq quota or need Kaggle online.
- Every real provider class (Groq, GPU worker, OpenAI-compatible) is tested against a mocked `fetch`.
- `tests/setup.ts` blocks any outbound request to a non-local host.
- Credentials from a local `.env` are removed before the tests run.

Coverage includes, for every remote provider:
- success, timeout, connection failure, offline ngrok tunnel
- 401/403, 429 (with `Retry-After`), 5xx and malformed responses
- missing or wrong worker key, and `<think>` stripping

It also covers environment validation (in a clean subprocess), the cookie/SameSite rules, Neon `sslmode=verify-full` parsing, and end-to-end calls through the public API.

To use a different Postgres, set `TEST_DATABASE_URL`, e.g. `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6000/kenya_engine_test bun test`. If your Postgres volume pre-dates `docker/init-test-db.sql`, create the database once: `docker compose exec postgres createdb -U postgres kenya_engine_test`.

## Docker

```bash
docker compose up --build api postgres     # API + DB with real models (needs JWT_SECRET, GROQ_API_KEY, SLM/TTS_SERVICE_URL, WORKER_API_KEY in .env)
docker compose --profile gpu up --build    # also starts the local GPU workers (NVIDIA GPU + container toolkit)
```

The API image contains no models and applies migrations on start. The compose API runs with `NODE_ENV=production`. If you switch `TTS_PROVIDER`/`SLM_PROVIDER` to `http` for the GPU profile, also set `WORKER_API_KEY` (≥16 chars) in `.env`, or startup validation will refuse to boot.

## Worker status

| Worker | Status |
|---|---|
| `../workers/kaggle/kenya_engine_worker.ipynb` (Sauti V2 + Qwen3.5-4B) | **production path, verified on Kaggle 2× T4 (29 Sep 2026).** Both models load and all smoke tests pass: TTS at about real time (RTF 1.1–1.25, 3.2 GiB VRAM), and chat replies in ~4–5 s (7.9 GiB VRAM). See [measurements](../workers/kaggle/README.md#measured-on-kaggle-2-t4-29-sep-2026) |
| Groq (Whisper Large V3 Turbo) | hosted; the provider is tested with mocked responses only |
| `../workers/stt-worker`, `slm-worker`, `tts-worker` (Docker) | untested local alternatives. `tts-worker` still has the Sauti `load_adapter` TODO; the notebook's Cell 4 has the working approach to port |

## Troubleshooting

| Symptom | Check |
|---|---|
| Exits at startup with "Invalid environment configuration" | the message names the variable, e.g. missing `GROQ_API_KEY`, `WORKER_API_KEY`, `SLM_BASE_URL`/`SLM_MODEL`, or a short `JWT_SECRET` |
| `/ready` → 503, `database: unavailable` | `DATABASE_URL`; `docker compose ps` locally |
| `/ready` → `slm`/`tts: unavailable` | the Kaggle notebook isn't running, or a model failed to load (`curl https://<NGROK_DOMAIN>/health`) |
| `503 TTS_UNAVAILABLE` / `SLM_UNAVAILABLE` | worker offline, still loading, out of GPU memory, timed out, or the key doesn't match. Look for "rejected our credentials" in the Render logs, and compare `WORKER_API_KEY` on Render and Kaggle |
| `503 STT_UNAVAILABLE` | Groq unreachable or `GROQ_API_KEY` invalid (Render logs: "rejected our credentials") |
| `429 RATE_LIMITED` with `Retry-After` | a provider (e.g. Groq's free tier) is throttling; wait as instructed |
| `413 PAYLOAD_TOO_LARGE` on transcription | the file is over 25 MB (Groq's limit) |
| `413` on chat | the conversation exceeds the worker's 8K-token context; trim the history |
| `401 API_KEY_INVALID` / `API_KEY_REVOKED` | key mistyped or revoked; create a new one |
| `404 MODEL_NOT_FOUND` | use the public IDs above, not provider names |
| Logged-in state lost between requests (frontend) | use the rewrite proxy, or `COOKIE_SAMESITE=none` plus `CORS_ORIGINS` plus `credentials: "include"` |
| GPU/model start-up problems | see [`../workers/kaggle/README.md`](../workers/kaggle/README.md#troubleshooting) |
