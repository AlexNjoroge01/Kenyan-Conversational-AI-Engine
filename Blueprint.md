Kenyan Conversational AI MVP Backend Blueprint

1. Purpose

Build the MVP backend API for the Kenyan Conversational AI platform described in the full Developer Build Specification.

This MVP includes the three core AI capabilities:

STT: speech → text

SLM: text → understanding/response/tool decision

TTS: text → speech

The immediate goal is:

Deploy the initial STT, SLM and TTS models, expose them through clean authenticated Express APIs, connect them into a basic conversational pipeline, document the APIs with Swagger/OpenAPI, and make the backend independently consumable by any client.

The Next.js frontend will be built later, after the backend API is working, tested, documented, and deployable.

The MVP does not need the complete production realtime platform yet. The initial backend should first prove that the three model components work independently and together.

The full Developer Build Specification remains the broader product context. This file defines the implementation scope and engineering rules for the MVP.

2. MVP Scope

Build now

Express.js API

TypeScript

Bun runtime/package manager

PostgreSQL

Drizzle ORM

Zod validation

JWT authentication

HTTP-only authentication cookies

API-key authentication for developer API consumption

CORS

Centralized error handling

STT using Whisper Large V3 Turbo

SLM using Qwen 3.5 4B

TTS using MsingiAI Sauti V2

POST /v1/audio/transcriptions

POST /v1/chat/completions

POST /v1/audio/speech

Basic STT → SLM → TTS conversational pipeline

API-key management

Usage/request logging

Swagger/OpenAPI documentation

README with setup and API consumption instructions

Health/readiness endpoints

Docker support

Environment-based configuration

Basic automated tests

Production-ready project structure

Build in a later phase

Do not implement these as part of the initial MVP unless required to make the basic pipeline work:

Next.js frontend

Full-duplex realtime WebSocket API

Voice activity detection

Barge-in/interruption

Phone/SIP integration

Advanced tool runtime

Billing/payment system

Model fine-tuning

Full Kenyan evaluation platform

Multi-model routing

Complex queues/autoscaling

Full developer dashboard

The architecture should allow these to be added later without restructuring the entire application.

3. Target MVP Flow

External Client
      |
      | POST /v1/audio/speech
      | Authorization: Bearer <API_KEY>
      v
+-----------------------+
| Express API           |
|                       |
| Middleware            |
|   CORS                |
|   JSON                |
|   Authentication      |
|   Validation          |
|   Error Handling      |
+-----------+-----------+
            |
            v
        Routes
            |
            v
       Controllers
            |
            v
         Services
            |
            v
     TTS Model Client
            |
            v
     Sauti V2 Worker
            |
            v
       Audio Output

The API must NOT contain model inference logic directly inside routes or controllers.

The Express backend should communicate with independent model inference services through clearly defined internal interfaces.

Recommended initial separation:

Express API
   |
   +--> STT Worker
   |
   +--> SLM Worker
   |
   +--> TTS Worker

The model workers may use Python where the underlying ML ecosystem requires it. The public application/API layer remains TypeScript/Bun/Express.

4. Technology Stack

Backend

Bun

Node-compatible Express.js

TypeScript

PostgreSQL

Drizzle ORM

Zod

JWT

HTTP-only cookies

Swagger/OpenAPI

Pino or equivalent structured logger

Vitest or Bun-compatible test tooling

Docker

TTS

Initial model:

msingiai/sauti_tts_v2

The TTS model may run as a separate Python-based inference service if required by the model's dependencies.

Do not force the Express application to execute ML inference directly.

The backend's responsibility is API orchestration.

5. Project Structure

Use separation of concerns.

Recommended structure:

backend/
├── src/
│   ├── app.ts
│   ├── server.ts
│   │
│   ├── config/
│   │   ├── env.ts
│   │   └── constants.ts
│   │
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema/
│   │   │   ├── users.ts
│   │   │   ├── api-keys.ts
│   │   │   └── usage-events.ts
│   │   └── migrations/
│   │
│   ├── middleware/
│   │   ├── cors.ts
│   │   ├── auth.ts
│   │   ├── api-key-auth.ts
│   │   ├── validate.ts
│   │   ├── not-found.ts
│   │   └── error-handler.ts
│   │
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── auth.routes.ts
│   │   ├── api-key.routes.ts
│   │   └── speech.routes.ts
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── api-key.controller.ts
│   │   ├── speech.controller.ts
│   │   └── health.controller.ts
│   │
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── api-key.service.ts
│   │   ├── speech.service.ts
│   │   ├── usage.service.ts
│   │   └── tts/
│   │       └── tts.service.ts
│   │
│   ├── repositories/
│   │   ├── user.repository.ts
│   │   ├── api-key.repository.ts
│   │   └── usage.repository.ts
│   │
│   ├── schemas/
│   │   ├── auth.schema.ts
│   │   ├── api-key.schema.ts
│   │   └── speech.schema.ts
│   │
│   ├── types/
│   │   ├── auth.ts
│   │   └── api.ts
│   │
│   ├── utils/
│   │   ├── errors.ts
│   │   ├── crypto.ts
│   │   └── response.ts
│   │
│   └── docs/
│       └── openapi.ts
│
├── tests/
├── Dockerfile
├── docker-compose.yml
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── bun.lock
├── .env.example
├── .gitignore
├── README.md
└── blueprint.md

The exact folder names may be adjusted slightly if required by implementation, but the separation of responsibilities must remain.

6. Separation of Concerns

The backend MUST follow this dependency direction:

Middleware
    |
    v
Routes
    |
    v
Controllers
    |
    v
Services
    |
    +-------> External Services / Model Workers
    |
    v
Repositories
    |
    v
PostgreSQL

Middleware

Responsible only for cross-cutting HTTP concerns:

CORS

JSON/body parsing

Authentication

API-key authentication

Validation

Request IDs

Error handling

Middleware must not contain business logic.

Routes

Routes only map HTTP methods and paths to controllers.

Example:

router.post(
  "/speech",
  authenticateApiKey,
  validate(speechSchema),
  speechController.createSpeech
);

Controllers

Controllers:

receive HTTP requests

obtain validated input

call services

format HTTP responses

Controllers must not contain database queries or model inference logic.

Services

Services contain business logic.

Examples:

authentication

API-key generation

speech generation

usage tracking

TTS orchestration

Repositories

Repositories contain database access.

Services should not directly contain raw database queries.

Database

PostgreSQL accessed through Drizzle ORM.

7. Authentication Design

There are two authentication contexts.

7.1 Application authentication

Use JWT stored in an HTTP-only cookie.

This is intended for authenticated users managing their account and API keys.

Example:

POST /auth/register
POST /auth/login
POST /auth/logout
GET  /auth/me

The JWT cookie must use appropriate production settings:

HttpOnly

Secure in production

SameSite appropriate to deployment

configurable expiration

Never expose the JWT to browser JavaScript.

7.2 Developer API authentication

The public /v1/* API should use API keys.

Example:

Authorization: Bearer sk_live_xxxxxxxxx

API keys must:

be generated securely

only be shown in full when created

be stored hashed in PostgreSQL

have a recognizable prefix

support revocation

have creation timestamps

have last-used timestamps

Never store plaintext API keys.

8. Database Schema

MVP tables:

users

id
email
password_hash
created_at
updated_at

Email must be unique.

Passwords must be securely hashed.

api_keys

id
user_id
name
key_prefix
key_hash
revoked_at
last_used_at
created_at

Relationship:

users 1 ---- N api_keys

usage_events

id
user_id
api_key_id
endpoint
model
request_id
status
duration_ms
input_characters
audio_duration_seconds
error_code
created_at

This table is for MVP observability and usage measurement.

Do not build billing calculations yet.

9. API Endpoints

Health

GET /health

Returns basic process health.

Example:

{
  "status": "ok"
}

Readiness

GET /ready

Checks required dependencies such as PostgreSQL and TTS availability.

Example:

{
  "status": "ready",
  "dependencies": {
    "database": "ok",
    "tts": "ok"
  }
}

Return HTTP 503 when the service is not ready.

10. Authentication API

Register

POST /auth/register

Request:

{
  "email": "developer@example.com",
  "password": "strong-password"
}

Validate with Zod.

Return a safe user representation.

Set the JWT in an HTTP-only cookie.

Login

POST /auth/login

Request:

{
  "email": "developer@example.com",
  "password": "strong-password"
}

Set HTTP-only JWT cookie.

Logout

POST /auth/logout

Clear the authentication cookie.

Current user

GET /auth/me

Requires JWT cookie.

Return:

{
  "id": "uuid",
  "email": "developer@example.com"
}

Never return password hashes.

11. API Key API

All API-key management endpoints require JWT authentication.

Create API key

POST /api-keys

Request:

{
  "name": "Local Development"
}

Response should show the plaintext key exactly once:

{
  "id": "uuid",
  "name": "Local Development",
  "key": "sk_live_xxxxxxxxx",
  "createdAt": "..."
}

After this response, only the hash remains in the database.

List API keys

GET /api-keys

Never return full API keys.

Return:

[
  {
    "id": "uuid",
    "name": "Local Development",
    "keyPrefix": "sk_live_abc",
    "createdAt": "...",
    "lastUsedAt": null,
    "revokedAt": null
  }
]

Revoke API key

DELETE /api-keys/:id

Revokes the key.

Prefer soft revocation using revoked_at.

12. STT API

Primary MVP endpoint:

POST /v1/audio/transcriptions

Requires:

Authorization: Bearer <API_KEY>

Accept audio using multipart/form-data.

Recommended fields:

file
model
language (optional)

Initial model:

whisper-large-v3-turbo

Example response:

{
  "text": "Nataka kujua status ya order yangu.",
  "model": "whisper-large-v3-turbo",
  "language": "sw"
}

The implementation should support common audio formats accepted by the inference worker.

The API must validate:

file presence

supported media type

maximum file size

model identifier

Do not expose model-specific infrastructure details to clients.

12.1 SLM / Chat API

Primary MVP endpoint:

POST /v1/chat/completions

Requires:

Authorization: Bearer <API_KEY>

Initial model:

qwen3.5-4b

Request:

{
  "model": "qwen3.5-4b",
  "messages": [
    {
      "role": "user",
      "content": "Nataka kujua status ya order yangu."
    }
  ],
  "stream": false
}

Response:

{
  "id": "chat_123",
  "model": "qwen3.5-4b",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "Nitaangalia status ya order yako."
      }
    }
  ]
}

The MVP should support:

system messages

user messages

assistant messages

basic conversation history

deterministic model selection

structured JSON output where required

The implementation should be designed so tool/function calling can be added later without replacing the chat API contract.

12.2 Basic Conversational Pipeline

After the three model APIs work independently, implement a basic internal service that connects them:

Audio
  |
  v
STT
  |
  | transcript
  v
SLM
  |
  | response
  v
TTS
  |
  v
Audio

This pipeline should be callable internally by the backend.

For the MVP, it does not need to be a full realtime WebSocket implementation.

The purpose is to prove the complete voice loop.

Example:

User audio
    ↓
Whisper
    ↓
"Niaje, unaweza kunisaidia?"
    ↓
Qwen
    ↓
"Ndiyo, naweza kukusaidia."
    ↓
Sauti V2
    ↓
Generated MP3/WAV

Keep each stage independently testable.

13. TTS API

Primary MVP endpoint:

POST /v1/audio/speech

Requires:

Authorization: Bearer <API_KEY>

Request:

{
  "model": "sauti-v2",
  "input": "Nimefika office, I will call you nikimaliza meeting.",
  "voice": "default",
  "response_format": "mp3",
  "stream": false
}

Validation

Use Zod.

Required:

model

input

Defaults:

voice = "default"

response_format = "mp3"

stream = false

Reject:

empty input

unsupported model

unsupported output format

excessively large input

malformed JSON

Supported model

Initially:

sauti-v2

Do not expose the underlying Hugging Face identifier as the public API model name.

This allows the implementation to change later without breaking clients.

13. Model Service Interfaces

The Express application must use provider interfaces for all three model types.

STT

interface SttProvider {
  transcribe(input: SttInput): Promise<SttResult>;
}

Initial implementation:

WhisperSttProvider

SLM

interface SlmProvider {
  complete(input: SlmInput): Promise<SlmResult>;
}

Initial implementation:

QwenSlmProvider

The SLM provider must support structured output and leave room for tool calls.

TTS

interface TtsProvider {
  synthesize(input: TtsInput): Promise<TtsResult>;
}

Initial implementation:

SautiTtsProvider

Each provider communicates with its corresponding model worker.

The model workers can be Python if the model/inference ecosystem requires Python ML dependencies.

This keeps ML infrastructure separate from the TypeScript API and allows models to be replaced without changing the public API.

15. Audio Response

For non-streaming requests:

Content-Type: audio/mpeg

or:

Content-Type: audio/wav

Return the generated audio directly.

Do not unnecessarily base64 encode audio.

The API should behave like a normal audio-generation API and be easy to consume using:

curl

JavaScript/TypeScript:

const response = await fetch(
  "https://api.example.com/v1/audio/speech",
  {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "sauti-v2",
      input: "Habari, karibu.",
      response_format: "mp3"
    })
  }
);

const audio = await response.arrayBuffer();

16. Streaming

Implement non-streaming TTS first.

Streaming support should be implemented only if the underlying Sauti V2 inference path supports reliable incremental audio generation.

Do not fake streaming by splitting an already-generated file into arbitrary chunks.

The API contract may reserve:

{
  "stream": true
}

but if true streaming is not yet implemented, return a clear structured error rather than pretending it is streaming.

17. Error Handling

Use one centralized error-handling middleware.

All errors should have a consistent structure:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request.",
    "requestId": "req_123"
  }
}

Suggested codes:

VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
NOT_FOUND
API_KEY_INVALID
API_KEY_REVOKED
MODEL_NOT_FOUND
TTS_UNAVAILABLE
TTS_GENERATION_FAILED
RATE_LIMITED
INTERNAL_ERROR

Do not expose stack traces or internal implementation details in production.

18. Request IDs and Logging

Every request must receive a unique request ID.

Return it in:

X-Request-ID

Use structured logging.

Log:

request ID

endpoint

method

status

duration

user ID when available

API key ID when available

model

TTS latency

error code

Do not log:

passwords

JWTs

full API keys

sensitive audio content

19. CORS

Configure CORS through environment variables.

Example:

CORS_ORIGINS=http://localhost:3000

Do not use unrestricted * in production when authenticated browser requests are required.

The future Next.js frontend should be able to call the backend without changing the architecture.

20. Environment Variables

Provide .env.example.

At minimum:

NODE_ENV=development
PORT=4000

DATABASE_URL=

JWT_SECRET=
JWT_EXPIRES_IN=7d
AUTH_COOKIE_NAME=auth_token

CORS_ORIGINS=http://localhost:3000

TTS_SERVICE_URL=http://localhost:8000
TTS_SERVICE_TIMEOUT_MS=30000

API_KEY_PREFIX=sk_live_

Never commit .env.

21. Swagger / OpenAPI

The API MUST have interactive Swagger documentation.

Expose:

/docs

The OpenAPI specification should document:

endpoints

request bodies

response bodies

authentication

API key authentication

cookies

error codes

models

status codes

examples

Use OpenAPI 3.x.

Define security schemes for:

bearerAuth
cookieAuth

The /v1/* endpoints should clearly document:

Authorization: Bearer <API_KEY>

Swagger UI must make the API easy to test.

Also expose the raw specification if practical:

/openapi.json

22. README.md

Create a comprehensive but concise README.

It must contain:

Project overview

What the backend does.

Requirements

Bun

Docker

PostgreSQL

GPU/TTS worker requirements

Installation

Example:

bun install

Environment setup

cp .env.example .env

Explain required variables.

Database

Document:

bunx drizzle-kit generate
bunx drizzle-kit migrate

Use the project's actual Drizzle commands if configured differently.

Development

Example:

bun run dev

Production

Explain how to build and start the API.

API documentation

Point developers to:

/docs

Authentication

Explain:

Create account.

Login.

Create API key.

Use API key with /v1/audio/speech.

TTS example

Include a working curl example.

Example:

curl https://api.example.com/v1/audio/speech \
  -H "Authorization: Bearer sk_live_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sauti-v2",
    "input": "Habari, karibu Kenya.",
    "voice": "default",
    "response_format": "mp3"
  }' \
  --output speech.mp3

Architecture

Include a concise architecture diagram.

Troubleshooting

Document common problems:

database unavailable

TTS worker unavailable

invalid API key

model unavailable

GPU/model startup issues

23. Docker

The API must have a Dockerfile.

The local development environment should preferably provide:

Express API
PostgreSQL
TTS service

through Docker Compose where practical.

Do not require the Express container itself to contain the GPU model.

The GPU model should be an independently deployable service.

24. Testing

At minimum test:

Authentication

registration

duplicate email

login

invalid credentials

logout

protected endpoints

API keys

create

list

revoke

revoked key rejected

invalid key rejected

TTS

valid request

invalid request

missing API key

invalid API key

unsupported model

TTS worker unavailable

successful audio response

Health

health endpoint

readiness endpoint

Tests should not require a live GPU for ordinary backend unit/integration tests.

Use mocks for the TTS provider.

25. Model Worker Contracts

Keep internal model-worker contracts simple and implementation-independent.

STT worker

POST /transcribe
Content-Type: multipart/form-data

Input:

audio file

Output:

{
  "text": "Nataka kujua status ya order yangu.",
  "language": "sw"
}

SLM worker

POST /complete
Content-Type: application/json

Input:

{
  "messages": [
    {
      "role": "user",
      "content": "Habari"
    }
  ]
}

Output:

{
  "content": "Habari! Naweza kukusaidia nini?"
}

TTS worker

POST /synthesize
Content-Type: application/json

Input:

{
  "text": "Habari, karibu.",
  "voice": "default",
  "format": "mp3"
}

Response:

audio/mpeg

The exact internal contracts can change as required by the model implementations.

The Express backend must not depend on Python-specific implementation details.

26. Performance Requirements

For the MVP, measure rather than prematurely optimize.

Record:

request latency

TTS generation latency

time to first audio if available

audio duration

GPU VRAM

concurrency

failures

retries

The first benchmark should use a fixed Kenyan text prompt set.

Example categories:

English
Kiswahili
English + Kiswahili
Kenyan names
Kenyan locations
Business conversations
Numbers
Dates
Currency

27. Security Requirements

Minimum requirements:

Hash passwords securely.

Hash API keys.

Use secure JWT secrets.

Use HTTP-only cookies.

Never log credentials.

Validate all external input with Zod.

Apply reasonable request size limits.

Apply basic rate limiting.

Use parameterized/database-safe queries through Drizzle.

Do not expose internal errors.

Configure CORS explicitly.

Use HTTPS in production.

Do not commit secrets.

28. API Versioning

All public AI APIs begin with:

/v1

Examples:

/v1/audio/speech
/v1/audio/transcriptions
/v1/chat/completions
/v1/realtime

Only implement /v1/audio/speech in the MVP.

Reserve the other paths for future phases.

Do not build STT, SLM or realtime functionality merely because the routes are reserved.

29. Future Architecture

The MVP must leave room for:

                    API Gateway
                         |
              +----------+----------+
              |                     |
        REST API              Realtime WS
              |                     |
              +----------+----------+
                         |
                  Orchestrator
                         |
          +--------------+--------------+
          |              |              |
         STT            SLM            TTS
          |              |              |
        GPU            GPU            GPU
                         |
                    Tool Runtime
                         |
                  External Systems

Future services can include:

stt-worker
slm-worker
tts-worker
realtime-orchestrator
tool-runner
metering-service

Do not prematurely implement all of them.

30. Implementation Order

Build in this order.

Step 1 — Bootstrap

Bun project

TypeScript

Express

ESLint/formatting if desired

environment configuration

health endpoint

Step 2 — PostgreSQL + Drizzle

database connection

schema

migrations

repositories

Step 3 — Authentication

registration

login

logout

JWT

HTTP-only cookie

current-user endpoint

Step 4 — API keys

generate

hash

store

list

revoke

API-key middleware

Step 5 — Model provider abstractions

Create:

SttProvider
SlmProvider
TtsProvider

Then implement:

WhisperSttProvider
QwenSlmProvider
SautiTtsProvider

Step 6 — Connect the model workers

Deploy and verify each worker independently:

Whisper → transcript
Qwen → response
Sauti → audio

Handle:

timeouts

unavailable workers

malformed responses

inference failures

Step 7 — Implement the three public APIs

Implement:

POST /v1/audio/transcriptions
POST /v1/chat/completions
POST /v1/audio/speech

Step 8 — Connect the basic voice pipeline

Implement:

audio → STT → SLM → TTS → audio

Keep the pipeline synchronous/non-realtime initially.

Step 9 — Usage logging

Record:

request

model

duration

status

latency

audio duration

errors

Step 9 — Swagger

Implement /docs and /openapi.json.

Step 10 — Tests

Test the entire backend using a mocked TTS provider and real PostgreSQL test environment where appropriate.

Step 11 — Docker

Containerize the API and local dependencies.

Step 12 — README

Document installation, configuration, authentication, API usage, Swagger and deployment.

Step 13 — Deployment

Deploy the API and TTS worker.

Then test the complete flow remotely:

API key
   ↓
POST /v1/audio/speech
   ↓
Express
   ↓
Sauti V2
   ↓
MP3/WAV

Only after this works reliably should development of the Next.js frontend begin.

31. Definition of Done

The MVP backend is complete when a developer can:

Clone the repository.

Follow the README.

Start the backend.

Connect PostgreSQL.

Create an account.

Log in.

Create an API key.

Open /docs.

Authorize Swagger using the API key.

Call POST /v1/audio/speech.

Submit Kenyan English/Kiswahili text.

Receive playable MP3/WAV audio.

See useful errors when something fails.

Inspect request/usage information.

Deploy the backend and TTS worker.

The product does not require a frontend to satisfy this definition of done.

32. Frontend Phase

After the backend MVP is stable, build the Next.js frontend separately.

The frontend will consume the existing APIs rather than embedding business logic or TTS logic.

Planned frontend functionality:

landing page

developer signup/login

API-key management

TTS playground

audio player

request history

usage dashboard

API documentation links

future realtime playground

The frontend must consume the same public API that external developers consume.

This ensures the API remains a real product interface rather than an internal backend hidden behind the frontend.

33. Engineering Principles

Keep the MVP small.

Separate HTTP concerns from business logic.

Keep model inference outside Express.

Use interfaces around external services.

Validate all external input.

Never expose secrets.

Make the API independently consumable.

Document every public endpoint.

Prefer measurable performance over premature optimization.

Do not build future functionality until the current milestone works.

Avoid unnecessary abstractions.

Keep public API contracts stable.

The end state of this MVP is a working, deployable Kenyan conversational AI backend with independently consumable STT, SLM and TTS APIs plus a basic end-to-end voice pipeline.

It is not yet the complete production realtime platform.