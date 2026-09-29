# Frontend Integration Guide — Kenyan Conversational AI

**Audience:** the engineer or coding agent building the Next.js frontend.
**Goal:** build a Next.js app, deployed on Vercel, that consumes every endpoint of the existing backend: accounts, login, API keys, speech-to-text, chat and text-to-speech. It also chains them into a voice conversation.

The backend is finished and deployed. **Do not change it, and do not re-implement any of its logic in the frontend.** Every endpoint shape below is taken from the backend source (`backend/src`). The live OpenAPI spec is the tie-breaker: `https://kenyan-conversational-ai-engine.onrender.com/openapi.json`, with Swagger UI at `/docs`.

---

## 1. What the backend is (end to end)

### 1.1 Product

An OpenAI-style voice API tuned for Kenyan English, Kiswahili and English–Kiswahili code-switching (e.g. *"Nimefika office, I will call you nikimaliza meeting."*).

| Capability | Endpoint | Public model ID | Actually served by |
|---|---|---|---|
| Speech → text (STT) | `POST /v1/audio/transcriptions` | `whisper-large-v3-turbo` | Groq (hosted Whisper Large V3 Turbo) |
| Text → reply (SLM) | `POST /v1/chat/completions` | `qwen3.5-4b` | Qwen3.5-4B on a Kaggle GPU notebook (hosted fallback possible) |
| Text → speech (TTS) | `POST /v1/audio/speech` | `sauti-v2` | MsingiAI Sauti V2 (Chatterbox + LoRA) on the same Kaggle notebook |

The frontend only ever uses the **public model IDs**. It never sees or needs Groq, Hugging Face, Kaggle or ngrok details.

### 1.2 Architecture

```
Browser
  │  same-origin requests to /api/*
  ▼
Vercel ── Next.js frontend (this project)
  │  next.config rewrite: /api/:path*  →  https://kenyan-conversational-ai-engine.onrender.com/:path*
  ▼
Render ── Express API (Bun + TypeScript), Frankfurt
  │   middleware: request ID → CORS → Helmet → JSON → cookies → auth (JWT cookie or API key) → rate limit → Zod validation
  │   routes → controllers → services → providers / repositories
  ├──► Neon PostgreSQL  (users, api_keys, usage_events)
  ├──► Groq             (speech-to-text)
  └──► https://<ngrok domain> ──► Kaggle notebook, 2× T4 GPUs
                                   ├─ /complete    Qwen3.5-4B
                                   └─ /synthesize  Sauti V2
```

How it was built:
- **Stack:** Express 5 on Bun, TypeScript, Drizzle ORM on PostgreSQL, Zod validation, pino logging, Swagger/OpenAPI docs.
- **Two auth systems:**
  1. **Session cookie** (JWT in an HTTP-only cookie) for humans managing their account and API keys.
  2. **API keys** (`Authorization: Bearer sk_live_…`) for the `/v1/*` AI endpoints.

  API keys are stored only as SHA-256 hashes, and the full key is shown exactly once. Passwords are bcrypt-hashed.
- **Provider interfaces:** each model sits behind one (`SttProvider`, `SlmProvider`, `TtsProvider`), switchable by environment (`groq` / `http` worker / `openai-compatible`); there is no mock mode. Swapping models never changes the public API.
- **Usage logging:** every `/v1/*` request, including failed ones, writes a `usage_events` row (endpoint, model, status, duration, input characters, audio duration, error code). There is **no endpoint that reads usage back yet** (see §9).
- **Request IDs:** every response has an `X-Request-ID` header, and every error uses the same JSON shape (§6).
- **Model workers:** the GPU models run in a Kaggle notebook exposed through ngrok. That notebook is **not always on**. When it's off, chat and speech return `503 *_UNAVAILABLE` quickly, and the UI must handle this gracefully (§6.3).

### 1.3 Things that affect the UI

| Fact | UI consequence |
|---|---|
| The Render free tier sleeps after about 15 minutes of inactivity; the first request can take ~30–60 s | show a "waking up the server…" state; don't time out fetches early |
| TTS on a T4 GPU is slow (can take tens of seconds, up to ~2 min for long text) | long-running spinner or progress state, a cancel button, disabled re-submit |
| The Kaggle GPU worker may be offline | `/ready` shows `slm`/`tts` as `unavailable`; show a status banner and friendly 503 messages |
| TTS may return WAV even when MP3 was requested (if the worker can't encode MP3) | always use the response `Content-Type`, never the requested format |
| API keys are shown once | force the user to copy or acknowledge the key before closing the dialog |

---

## 2. Tech stack for the frontend

Use the standard stack, **minus the pieces the backend already owns**:

| Layer | Use |
|---|---|
| Framework | Next.js 16.1.3 (App Router), TypeScript |
| Styling / UI | Tailwind CSS, shadcn/ui, remix icons, Framer Motion (subtle only) |
| Forms | React Hook Form + Zod (mirror the backend rules in §4) |
| Server state | TanStack React Query (all API calls) |
| Client state | Zustand (the in-memory API key for the playground, UI state) |
| Toasts | Sonner |

**Do NOT add:** Prisma, a PostgreSQL database, NextAuth, Resend, Cloudinary or Vercel cron.
- Accounts, sessions, API keys and usage all live in the backend.
- The frontend is a client of the public API, exactly like any external developer.
- A second auth system or database would duplicate and conflict with the backend.
- Audio is generated per request and played or downloaded in the browser; it is not stored.

---

## 3. Connecting to the backend

### 3.1 Same-origin rewrite proxy (required approach)

```js
// next.config.mjs
const BACKEND_URL = process.env.BACKEND_URL ?? "https://kenyan-conversational-ai-engine.onrender.com";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/:path*` }];
  },
};
export default nextConfig;
```

- The browser only ever calls **relative** URLs such as `/api/auth/login` or `/api/v1/chat/completions`.
- The auth cookie is therefore first-party to the Vercel domain. The backend sets it host-only with `SameSite=Lax`, `HttpOnly`, and `Secure` in production.
- No CORS is involved, and third-party-cookie blocking cannot break login.
- `BACKEND_URL` is a **server-side** env var (no `NEXT_PUBLIC_` prefix). Point it at `http://localhost:4000` to develop against a local backend.
- **Do not** create Next.js API route handlers that proxy or duplicate backend logic. The rewrite is the whole integration.
- **Do not** use a Next.js `/api` route folder (`app/api/**`): it would shadow the rewrite.

The backend's JSON routes (`/auth`, `/api-keys`, `/v1`, `/health`, `/ready`) all work under `/api/…`. For API docs, link to `https://kenyan-conversational-ai-engine.onrender.com/docs` directly rather than through the proxy.

**To verify once deployed:**
- the maximum request body and response time of Vercel external rewrites on the plan in use;
- that a transcription upload of several MB passes;
- that a TTS request lasting ~60–120 s isn't cut off.

If either limit is hit, report it rather than working around it in the frontend. The fallback is §3.2.

### 3.2 Fallback: direct cross-site calls (only if the proxy is ruled out)

The browser calls Render directly with `fetch(url, { credentials: "include" })`. The backend must then be reconfigured (the backend owner does this):
- `COOKIE_SAMESITE=none`
- the Vercel domain added to `CORS_ORIGINS`

Safari and Chrome with tracking protection may drop the session cookie, so this is the fallback only.

---

## 4. Endpoint reference

All paths below are shown **as the frontend calls them** (with the `/api` prefix). All JSON requests need `Content-Type: application/json`.

### 4.1 Service status (no auth)

| Call | Response |
|---|---|
| `GET /api/` | `200 {"name":"Kenyan Conversational AI API","version":"1.1.0","docs":"/docs","openapi":"/openapi.json"}` (available once the latest backend is deployed) |
| `GET /api/health` | `200 {"status":"ok"}` (the process is up) |
| `GET /api/ready` | `200` or `503` `{"status":"ready"\|"not_ready","dependencies":{"database":"ok"\|"unavailable","stt":…,"slm":…,"tts":…}}` |

Use `/ready` for a status indicator: "Speech-to-text ● Chat ● Voice". Poll it every ~30–60 s at most (results are cached server-side for ~10 s). A `503` from `/ready` is **data**, not an error: read the body.

### 4.2 Accounts: session cookie auth

The session is an **HTTP-only cookie** named `auth_token`, valid for 7 days. The frontend never reads, stores or sends the JWT itself; the browser does it automatically on same-origin requests. There is no token in any response body.

#### Register: `POST /api/auth/register`

```jsonc
// request
{ "email": "alexnjoroge102@gmail.com", "password": "Password123" }
// 201 → sets the session cookie
{ "id": "7f0c…-uuid", "email": "alexnjoroge102@gmail.com" }
```
- email: valid email, ≤ 320 chars; trimmed and lower-cased by the server
- password: 8–72 characters
- errors: `400 VALIDATION_ERROR` (with `details`), `409 EMAIL_ALREADY_EXISTS`, `429 RATE_LIMITED`
- The user is **logged in immediately** after registering.

#### Log in: `POST /api/auth/login`

```jsonc
{ "email": "developer@example.com", "password": "strong-password" }
// 200 → sets the session cookie
{ "id": "…", "email": "developer@example.com" }
```
- errors: `401 INVALID_CREDENTIALS` (the same for an unknown email or a wrong password; show one generic message), `400`, `429`

Register and login are rate-limited to **10 requests per minute per IP** (`429 RATE_LIMITED`); show "Too many attempts, try again in a minute".

#### Current user: `GET /api/auth/me`

`200 {"id","email"}`, or `401 UNAUTHORIZED` when not logged in or the session expired. **This is how the frontend knows whether the user is logged in.**

#### Log out: `POST /api/auth/logout`

`204` with no body; clears the cookie. Afterwards, clear all React Query caches and the in-memory API key.

### 4.3 API keys: session cookie auth

All three calls require the session cookie; `401 UNAUTHORIZED` means redirect to login.

#### Create: `POST /api/api-keys`

```jsonc
{ "name": "Playground" }              // 1–100 chars, trimmed
// 201
{ "id": "uuid", "name": "Playground", "key": "sk_live_3kJ…(long)", "createdAt": "2026-09-29T10:00:00.000Z" }
```
`key` is the **only time the full key is ever returned**. The UI must:
1. show it in a dialog with a copy button and a "store it securely, it won't be shown again" warning;
2. offer "Use this key in the playground", which puts it in the Zustand store (memory only, §5.3);
3. never send it to analytics or logs, and never put it in a URL.

#### List: `GET /api/api-keys`

```jsonc
// 200, newest first; revoked keys are included (revokedAt set)
[
  { "id": "uuid", "name": "Playground", "keyPrefix": "sk_live_3kJx",
    "createdAt": "…", "lastUsedAt": "…" | null, "revokedAt": null | "…" }
]
```
Show name, `keyPrefix…`, created, last used and status (Active or Revoked). The full key cannot be shown again.

#### Revoke: `DELETE /api/api-keys/{id}`

`204` on success (idempotent). `404 NOT_FOUND` if the key doesn't belong to the user; `400` for a malformed id. Confirm before revoking. If the revoked key is the one held in the playground store, clear it.

### 4.4 AI endpoints: API-key auth (`/v1/*`)

These use `Authorization: Bearer <API_KEY>`, **not** the cookie. That is deliberate: the frontend uses the public API exactly as external developers do. Limits are 100 requests per minute per key.

Auth errors on all three:
- `401 UNAUTHORIZED`: the header is missing
- `401 API_KEY_INVALID`: the key is unknown or malformed
- `401 API_KEY_REVOKED`

#### Speech to text: `POST /api/v1/audio/transcriptions` (multipart)

| Field | Required | Notes |
|---|---|---|
| `file` | yes | audio file: wav, mp3, m4a, ogg, webm, flac or mp4, **≤ 25 MB** |
| `model` | yes | `whisper-large-v3-turbo` |
| `language` | no | ISO 639-1 code (`sw`, `en`); omit to auto-detect |

```jsonc
// 200
{ "text": "Nataka kujua status ya order yangu.", "model": "whisper-large-v3-turbo", "language": "sw" }
```
- Other errors: `400` (missing file or bad language), `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `404 MODEL_NOT_FOUND`, `422`/`502 STT_TRANSCRIPTION_FAILED`, `503 STT_UNAVAILABLE`, `429 RATE_LIMITED`.
- `language` may be `"und"` when it couldn't be determined.
- Build the body with `FormData`, and do **not** set `Content-Type` yourself (the browser adds the multipart boundary).
- Microphone recordings from `MediaRecorder` are fine: Chrome produces `audio/webm;codecs=opus` and Safari `audio/mp4`. Give the file a matching extension, e.g. `recording.webm`.

#### Chat: `POST /api/v1/chat/completions`

```jsonc
// request
{
  "model": "qwen3.5-4b",
  "messages": [
    { "role": "system", "content": "Wewe ni msaidizi wa huduma kwa wateja nchini Kenya. Jibu kwa ufupi." },
    { "role": "user", "content": "Nataka kujua status ya order yangu." }
  ],
  "temperature": 0.7,                        // optional, 0–2
  "max_tokens": 256,                         // optional, 1–4096
  "response_format": { "type": "text" },     // optional; "json_object" forces a JSON reply
  "stream": false                            // optional; true → 501 NOT_IMPLEMENTED (no streaming yet)
}
// 200
{
  "id": "chat_5b1…",
  "object": "chat.completion",
  "created": 1790000000,
  "model": "qwen3.5-4b",
  "choices": [{ "index": 0, "message": { "role": "assistant", "content": "Nitaangalia status ya order yako." }, "finish_reason": "stop" }]
}
```
- Rules: 1–100 messages; roles `system`, `user`, `assistant`; content non-empty.
- **The API is stateless:** conversation history is whatever the client sends. Keep the transcript in client state and send the whole history each turn. If you get `413 PAYLOAD_TOO_LARGE` (the conversation exceeds the model's 8K-token context), drop the oldest turns but keep the system message.
- Errors: `400`, `404 MODEL_NOT_FOUND`, `413`, `422`/`502 SLM_COMPLETION_FAILED`, `503 SLM_UNAVAILABLE`, `429`, `501` (stream).
- Replies never contain `<think>` reasoning. Render the content as plain text, or as sanitised Markdown.

#### Text to speech: `POST /api/v1/audio/speech`

```jsonc
{
  "model": "sauti-v2",
  "input": "Nimefika office, I will call you nikimaliza meeting.",   // 1–N chars, not whitespace-only
  "voice": "default",           // only "default" exists
  "response_format": "mp3",     // "mp3" | "wav" (default mp3)
  "stream": false               // true → 501
}
```
- **Success is a binary audio body, not JSON.**
- `Content-Type` is `audio/mpeg` or `audio/wav`. It is authoritative: WAV may come back even when MP3 was requested.
- Extra headers: `Content-Disposition: inline; filename="speech.mp3|wav"`, and `X-Request-ID`.
- The maximum input length is a server setting: 4000 by default, 500 recommended in production. The exact limit comes back in the `400` error text ("Input must be at most N characters."). Show a character counter with a configurable limit, e.g. `NEXT_PUBLIC_TTS_MAX_CHARS=500`.
- Errors come back as **JSON** with an error status: `400`, `404 MODEL_NOT_FOUND`, `413`, `422`/`502 TTS_GENERATION_FAILED`, `503 TTS_UNAVAILABLE`, `429`, `501`. Always check `res.ok` before treating the body as audio.

---

## 5. Implementation

### 5.1 Typed API client (`lib/api.ts`)

```ts
export type ApiErrorBody = {
  error: { code: string; message: string; requestId: string; details?: { field: string; issue: string }[] };
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: { field: string; issue: string }[],
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  const retry = Number(res.headers.get("retry-after"));
  return new ApiError(
    res.status,
    body?.error.code ?? "HTTP_" + res.status,
    body?.error.message ?? "Unexpected response from the server.",
    body?.error.requestId ?? res.headers.get("x-request-id") ?? undefined,
    body?.error.details,
    Number.isFinite(retry) && retry > 0 ? retry : undefined,
  );
}

/** JSON call through the same-origin proxy. Session cookies are sent automatically. */
export async function api<T>(path: string, init: RequestInit & { apiKey?: string } = {}): Promise<T> {
  const { apiKey, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: {
      ...(rest.body && !(rest.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) throw await toApiError(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** TTS: returns audio, never parses success as JSON. */
export async function synthesize(apiKey: string, input: string, format: "mp3" | "wav" = "mp3", signal?: AbortSignal) {
  const res = await fetch("/api/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "sauti-v2", input, voice: "default", response_format: format }),
    signal,
  });
  if (!res.ok) throw await toApiError(res);
  const blob = await res.blob();
  const contentType = res.headers.get("content-type") ?? blob.type;
  return { blob, contentType, extension: contentType.includes("wav") ? "wav" : "mp3", requestId: res.headers.get("x-request-id") };
}

export function transcribe(apiKey: string, file: Blob, filename: string, language?: string) {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", "whisper-large-v3-turbo");
  if (language) form.append("language", language);
  return api<{ text: string; model: string; language: string }>("/v1/audio/transcriptions", { method: "POST", body: form, apiKey });
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export function chat(apiKey: string, messages: ChatMessage[], opts: { temperature?: number; max_tokens?: number; json?: boolean } = {}) {
  return api<{ id: string; model: string; choices: { message: { role: "assistant"; content: string } }[] }>(
    "/v1/chat/completions",
    {
      method: "POST",
      apiKey,
      body: JSON.stringify({
        model: "qwen3.5-4b",
        messages,
        temperature: opts.temperature,
        max_tokens: opts.max_tokens,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    },
  );
}

// Accounts and keys (cookie session)
export type User = { id: string; email: string };
export type ApiKeySummary = { id: string; name: string; keyPrefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
export const auth = {
  register: (email: string, password: string) => api<User>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => api<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
  me: () => api<User>("/auth/me"),
};
export const apiKeys = {
  list: () => api<ApiKeySummary[]>("/api-keys"),
  create: (name: string) => api<{ id: string; name: string; key: string; createdAt: string }>("/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
  revoke: (id: string) => api<void>(`/api-keys/${id}`, { method: "DELETE" }),
};
export const status = {
  ready: async () => {
    const res = await fetch("/api/ready");
    return (await res.json()) as { status: "ready" | "not_ready"; dependencies: Record<"database" | "stt" | "slm" | "tts", "ok" | "unavailable"> };
  },
};
```

### 5.2 Session handling

- A React Query hook `useMe()` calls `auth.me()` with `retry: false`: `401` means logged out.
- Protected pages (`/dashboard/**`) are client-guarded. If `useMe()` errors with `401`, redirect to `/login?next=…`.
- Optional: `middleware.ts` can do a coarse redirect when the `auth_token` cookie is absent. It must not try to verify the JWT (the secret is backend-only), so the backend's `401` stays the source of truth.
- After login or register: `queryClient.invalidateQueries()` and route to `/dashboard`.
- After logout: `queryClient.clear()`, clear the Zustand API key, route to `/`.
- Any `401 UNAUTHORIZED` from `/auth/me` or `/api-keys` means the session expired: redirect to login with a toast.
- Server Components must **not** call the backend for user data: the cookie belongs to the browser. Keep authenticated fetching in client components with React Query.

### 5.3 The playground API key

The `/v1` endpoints need a plaintext API key, but the backend only reveals it once, so:
- Keep it in a Zustand store in **memory**; optionally persist it to `sessionStorage` (per tab, cleared when the tab closes).
- Never persist it to `localStorage` or cookies, and never render it after the create dialog, except masked (`sk_live_3kJx••••`).
- Offer two ways to set it:
  - "Use this key" in the create dialog;
  - a "Paste an API key" input in the playground (for keys created earlier or elsewhere).
- If a `/v1` call returns `401 API_KEY_INVALID` or `API_KEY_REVOKED`, clear the stored key and prompt for a new one.

### 5.4 Microphone recording (STT and voice turn)

```ts
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
const chunks: Blob[] = [];
recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
recorder.onstop = async () => {
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: recorder.mimeType });
  const ext = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
  const result = await transcribe(apiKey, blob, `recording.${ext}`, language);
};
recorder.start();
```
Cap recordings at about 2 minutes and show a timer. The microphone needs HTTPS or localhost.

### 5.5 Voice turn (client-side pipeline)

There is no public pipeline endpoint, so the frontend chains the three public ones:

```
record audio → POST /v1/audio/transcriptions → append {role:"user", content:text}
             → POST /v1/chat/completions (full history) → append the assistant reply
             → POST /v1/audio/speech (the reply) → auto-play the audio
```
- Show each stage's status: transcribing → thinking → speaking.
- Show the per-stage timing measured client-side.
- If a stage fails, keep the earlier results. For example, if TTS is unavailable, still show the text reply with "voice unavailable right now".

### 5.6 Audio playback and download

```ts
const url = URL.createObjectURL(blob);    // <audio controls src={url} /> and <a href={url} download={`speech.${extension}`}>
// Revoke the previous URL when replacing it or on unmount: URL.revokeObjectURL(url)
```

---

## 6. Errors and UX

### 6.1 Shape

Every error body is:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request.", "requestId": "req_abc123", "details": [{ "field": "password", "issue": "Password must be at least 8 characters." }] } }
```
`details` appears only on `VALIDATION_ERROR`; map `details[].field` to form fields in React Hook Form (`setError`). Show `requestId` in error toasts or a "copy error ID" affordance, for support.

### 6.2 Code → message

| Code | Status | Show |
|---|---|---|
| `VALIDATION_ERROR` | 400 | field errors, or the message |
| `UNAUTHORIZED` | 401 | session expired: redirect to login (on `/v1`: "Add an API key") |
| `INVALID_CREDENTIALS` | 401 | "Incorrect email or password." |
| `EMAIL_ALREADY_EXISTS` | 409 | "An account with this email already exists. Log in instead?" |
| `API_KEY_INVALID` / `API_KEY_REVOKED` | 401 | "This API key is invalid or revoked. Choose another key." |
| `MODEL_NOT_FOUND` | 404 | should never happen (a frontend bug) |
| `NOT_FOUND` | 404 | "Not found" (e.g. revoking a missing key) |
| `PAYLOAD_TOO_LARGE` | 413 | file over 25 MB, text too long, or conversation too long (trim history) |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | "Unsupported audio format." |
| `RATE_LIMITED` | 429 | "Too many requests, retry in N s" (use `Retry-After` when present) |
| `NOT_IMPLEMENTED` | 501 | never send `stream: true` |
| `STT_UNAVAILABLE` / `SLM_UNAVAILABLE` / `TTS_UNAVAILABLE` | 503 | "The speech-to-text / chat / voice service is offline or warming up. Try again shortly." |
| `STT_TRANSCRIPTION_FAILED` / `SLM_COMPLETION_FAILED` / `TTS_GENERATION_FAILED` | 422 / 502 | "Couldn't process that. Try different input." |
| `INTERNAL_ERROR` | 500 | generic error with the request ID |

### 6.3 Resilience rules

- **Don't auto-retry** `/v1` calls in React Query (`retry: false` for mutations). Retrying a 2-minute TTS job, or a request that hit a rate limit, makes things worse.
- For `503 *_UNAVAILABLE`, show a banner linked to the `/ready` status.
- Use `AbortController` for TTS and chat with a client timeout of about 150 s, and give the user a Cancel button.
- A network error or HTML response from the proxy (Vercel error pages, or Render waking up) must not crash the parser: `toApiError` already falls back to a generic error.

---

## 7. Pages to build

| Route | Auth | Contents |
|---|---|---|
| `/` | public | landing: what the platform does (Kenyan English, Kiswahili, code-switching), live service status from `/ready`, CTA to sign up, link to the API docs |
| `/signup`, `/login` | public | forms (RHF + Zod: valid email, password 8–72); on success go to `/dashboard` |
| `/dashboard` | session | welcome (email from `/auth/me`), service status, quick links |
| `/dashboard/api-keys` | session | list (active and revoked), create dialog with show-once key and copy, revoke with confirmation, "use in playground" |
| `/dashboard/playground/speech` | session + key | TTS: textarea with character counter, format select (mp3/wav), generate, audio player, download; sample buttons for English, Kiswahili and code-switched text |
| `/dashboard/playground/transcribe` | session + key | STT: upload **or** record, language select (auto / sw / en), transcript with copy |
| `/dashboard/playground/chat` | session + key | chat UI with editable system prompt, history, temperature and max tokens, JSON-mode toggle, "clear conversation"; optional "speak reply" button (calls TTS) |
| `/dashboard/playground/voice` | session + key | voice turn (§5.5): push-to-talk, transcript and reply bubbles, auto-played speech |
| `/docs` link | public | external link to the backend `/docs` (Swagger) |

Sample texts for the playground:
- English: *"Good morning. Your order has been dispatched and will arrive in Nairobi tomorrow."*
- Kiswahili: *"Habari za asubuhi. Oda yako imetumwa na itafika Nairobi kesho."*
- Code-switched: *"Nimefika office, I will call you nikimaliza meeting."*

Show a key picker at the top of every playground page. If no key is in the store, show "Create or paste an API key" instead.

---

## 8. Environment and deployment

| Var | Where | Value |
|---|---|---|
| `BACKEND_URL` | Vercel (server-side) and `.env.local` | `https://kenyan-conversational-ai-engine.onrender.com` (or `http://localhost:4000`) |
| `NEXT_PUBLIC_TTS_MAX_CHARS` | Vercel and `.env.local` | `500` (match the backend's `TTS_MAX_INPUT_CHARACTERS`) |
| `NEXT_PUBLIC_API_DOCS_URL` | Vercel and `.env.local` | `https://kenyan-conversational-ai-engine.onrender.com/docs` |

No secrets live in the frontend.

After deploying to Vercel, **report the production domain** (e.g. `https://your-app.vercel.app`) to the backend owner. They will add it to the backend's `CORS_ORIGINS`: not needed for the proxy, but kept correct for the cross-site fallback and direct developer testing.

### 8.1 Local development

- **Against Render:** leave `BACKEND_URL` at the Render URL and run `npm run dev` on port 3000.
- **Against a local backend:** in `backend/`, run `bun run dev` (port 4000), then set `BACKEND_URL=http://localhost:4000`.

The backend has **no mock mode**: every reply comes from the real models (Groq for STT; the Kaggle notebook for chat and speech). If chat or speech return `503 *_UNAVAILABLE`, the Kaggle notebook isn't running. That is a backend or ops issue, not a frontend bug.

---

## 9. Not available yet (don't build against it)

- **Usage history or dashboard data:** usage is recorded, but no endpoint reads it. Show a "coming soon" placeholder, or leave it out.
- **Streaming** (`stream: true`) and the **realtime WebSocket** `/v1/realtime` (returns `501`).
- **Password reset, email verification, account deletion, and renaming keys** have no endpoints.
- **Multiple voices:** only `"default"`.
- **A pipeline endpoint:** chain the three endpoints client-side (§5.5).

If a feature needs one of these, stop and ask rather than inventing an endpoint.

---

## 10. Acceptance checklist

1. Sign up → lands on the dashboard, and `/api/auth/me` returns the user.
2. Log out → protected pages redirect to login; log in again works; a wrong password shows the generic message.
3. Create an API key → the full key is shown once with copy; the list shows the prefix only; revoke works, and the revoked key is rejected by the playground with a clear message.
4. TTS → plays and downloads audio; the file extension matches the response `Content-Type`; an over-length input shows the server's validation message.
5. STT → both upload and microphone recording return a transcript; a 30 MB file gets a clear "too large" error.
6. Chat → a multi-turn conversation keeps its history; JSON mode returns JSON; clearing the conversation resets the history.
7. Voice turn → record → transcript → reply → spoken audio, with per-stage status.
8. With the GPU worker off → chat and speech show the "service offline" message, STT still works, and `/ready` shows the status.
9. Every error toast shows the backend `requestId`.
10. No API key or JWT appears in `localStorage`, URLs, console logs or analytics.
11. Works on the deployed Vercel domain through the `/api` rewrite (cookies set first-party, no CORS errors).
