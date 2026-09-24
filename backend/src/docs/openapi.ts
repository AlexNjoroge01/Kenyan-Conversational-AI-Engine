import { env } from "../config/env";
import { MODELS, TTS_FORMATS } from "../config/constants";

const errorResponse = (description: string, code: string, message: string) => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
      example: { error: { code, message, requestId: "req_a1b2c3d4e5f6" } },
    },
  },
});

const v1Errors = {
  "400": errorResponse("Validation error.", "VALIDATION_ERROR", "Invalid request."),
  "401": errorResponse("Missing, invalid or revoked API key.", "API_KEY_INVALID", "The API key provided is invalid."),
  "404": errorResponse("Model not found.", "MODEL_NOT_FOUND", "The model 'x' does not exist or is not supported."),
  "429": errorResponse("Rate limit exceeded.", "RATE_LIMITED", "Too many requests. Please slow down."),
  "500": errorResponse("Unexpected server error.", "INTERNAL_ERROR", "An unexpected error occurred."),
};

const cookieErrors = {
  "400": errorResponse("Validation error.", "VALIDATION_ERROR", "Invalid request."),
  "401": errorResponse("Not authenticated.", "UNAUTHORIZED", "Authentication required."),
  "429": errorResponse("Rate limit exceeded.", "RATE_LIMITED", "Too many requests. Please slow down."),
};

const credentials = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string", format: "email", example: "developer@example.com" },
    password: { type: "string", minLength: 8, maxLength: 72, format: "password", example: "strong-password" },
  },
};

const setCookieHeader = {
  "Set-Cookie": {
    description: `HTTP-only JWT cookie (${env.AUTH_COOKIE_NAME}).`,
    schema: { type: "string" },
  },
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Kenyan Conversational AI API",
    version: "1.0.0",
    description: [
      "Speech-to-text, language model and text-to-speech APIs tuned for English, Kiswahili and code-switching.",
      "",
      "**Getting started**",
      "1. `POST /auth/register` to create an account (sets an HTTP-only session cookie).",
      "2. `POST /api-keys` to create an API key. The full key is shown **once**.",
      "3. Click **Authorize** and paste the key (without `Bearer `) into `bearerAuth`.",
      "4. Call any `/v1/*` endpoint.",
      "",
      "Every response carries an `X-Request-ID` header; quote it when reporting problems.",
    ].join("\n"),
  },
  servers: [{ url: "/", description: "This server" }],
  tags: [
    { name: "Health" },
    { name: "Auth", description: "Account management. Uses the session cookie." },
    { name: "API Keys", description: "Manage developer API keys. Uses the session cookie." },
    { name: "Audio", description: "Speech-to-text and text-to-speech. Uses an API key." },
    { name: "Chat", description: "Language model. Uses an API key." },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: `API key, e.g. \`${env.API_KEY_PREFIX}xxxxxxxx\`. Sent as \`Authorization: Bearer <API_KEY>\`.`,
      },
      cookieAuth: { type: "apiKey", in: "cookie", name: env.AUTH_COOKIE_NAME, description: "HTTP-only JWT set by /auth/login." },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: {
                type: "string",
                enum: [
                  "VALIDATION_ERROR",
                  "UNAUTHORIZED",
                  "FORBIDDEN",
                  "NOT_FOUND",
                  "EMAIL_ALREADY_EXISTS",
                  "INVALID_CREDENTIALS",
                  "API_KEY_INVALID",
                  "API_KEY_REVOKED",
                  "MODEL_NOT_FOUND",
                  "PAYLOAD_TOO_LARGE",
                  "UNSUPPORTED_MEDIA_TYPE",
                  "NOT_IMPLEMENTED",
                  "STT_UNAVAILABLE",
                  "STT_TRANSCRIPTION_FAILED",
                  "SLM_UNAVAILABLE",
                  "SLM_COMPLETION_FAILED",
                  "TTS_UNAVAILABLE",
                  "TTS_GENERATION_FAILED",
                  "RATE_LIMITED",
                  "INTERNAL_ERROR",
                ],
              },
              message: { type: "string" },
              requestId: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: { field: { type: "string" }, issue: { type: "string" } },
                },
              },
            },
          },
        },
      },
      User: {
        type: "object",
        properties: { id: { type: "string", format: "uuid" }, email: { type: "string", format: "email" } },
      },
      ApiKeyCreated: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", example: "Local Development" },
          key: { type: "string", description: "Shown only once.", example: `${env.API_KEY_PREFIX}xxxxxxxxxxxxxxxx` },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      ApiKeySummary: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          keyPrefix: { type: "string", example: `${env.API_KEY_PREFIX}abc` },
          createdAt: { type: "string", format: "date-time" },
          lastUsedAt: { type: "string", format: "date-time", nullable: true },
          revokedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      SpeechRequest: {
        type: "object",
        required: ["model", "input"],
        properties: {
          model: { type: "string", enum: [MODELS.tts], example: MODELS.tts },
          input: {
            type: "string",
            maxLength: env.TTS_MAX_INPUT_CHARACTERS,
            example: "Nimefika office, I will call you nikimaliza meeting.",
          },
          voice: { type: "string", enum: ["default"], default: "default" },
          response_format: { type: "string", enum: [...TTS_FORMATS], default: "mp3" },
          stream: { type: "boolean", default: false, description: "Streaming is reserved; `true` returns 501 NOT_IMPLEMENTED." },
        },
      },
      ChatMessage: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant"] },
          content: { type: "string" },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["model", "messages"],
        properties: {
          model: { type: "string", enum: [MODELS.slm], example: MODELS.slm },
          messages: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/ChatMessage" },
            example: [{ role: "user", content: "Nataka kujua status ya order yangu." }],
          },
          stream: { type: "boolean", default: false, description: "Streaming is reserved; `true` returns 501 NOT_IMPLEMENTED." },
          temperature: { type: "number", minimum: 0, maximum: 2 },
          max_tokens: { type: "integer", minimum: 1, maximum: 4096 },
          response_format: {
            type: "object",
            properties: { type: { type: "string", enum: ["text", "json_object"] } },
            description: "Use `json_object` to require valid JSON output.",
          },
        },
      },
      ChatCompletion: {
        type: "object",
        properties: {
          id: { type: "string", example: "chat_123" },
          object: { type: "string", example: "chat.completion" },
          created: { type: "integer" },
          model: { type: "string", example: MODELS.slm },
          choices: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                message: { $ref: "#/components/schemas/ChatMessage" },
                finish_reason: { type: "string", example: "stop" },
              },
            },
          },
        },
      },
      Transcription: {
        type: "object",
        properties: {
          text: { type: "string", example: "Nataka kujua status ya order yangu." },
          model: { type: "string", example: MODELS.stt },
          language: { type: "string", example: "sw" },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Process health",
        responses: {
          "200": {
            description: "The process is up.",
            content: { "application/json": { example: { status: "ok" } } },
          },
        },
      },
    },
    "/ready": {
      get: {
        tags: ["Health"],
        summary: "Dependency readiness",
        description: "Checks PostgreSQL and the model workers. Returns 503 when a required dependency is unavailable.",
        responses: {
          "200": {
            description: "Ready.",
            content: {
              "application/json": {
                example: { status: "ready", dependencies: { database: "ok", stt: "ok", slm: "ok", tts: "ok" } },
              },
            },
          },
          "503": {
            description: "Not ready.",
            content: {
              "application/json": {
                example: { status: "not_ready", dependencies: { database: "ok", stt: "ok", slm: "ok", tts: "unavailable" } },
              },
            },
          },
        },
      },
    },
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Create an account",
        requestBody: { required: true, content: { "application/json": { schema: credentials } } },
        responses: {
          "201": {
            description: "Account created; session cookie set.",
            headers: setCookieHeader,
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
          ...cookieErrors,
          "409": errorResponse("Email already registered.", "EMAIL_ALREADY_EXISTS", "An account with this email already exists."),
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in",
        requestBody: { required: true, content: { "application/json": { schema: credentials } } },
        responses: {
          "200": {
            description: "Logged in; session cookie set.",
            headers: setCookieHeader,
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
          },
          ...cookieErrors,
          "401": errorResponse("Wrong email or password.", "INVALID_CREDENTIALS", "Invalid email or password."),
        },
      },
    },
    "/auth/logout": {
      post: { tags: ["Auth"], summary: "Log out", responses: { "204": { description: "Session cookie cleared." } } },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Current user",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "The signed-in user.", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
          "401": cookieErrors["401"],
        },
      },
    },
    "/api-keys": {
      post: {
        tags: ["API Keys"],
        summary: "Create an API key",
        description: "The plaintext key is returned once. Store it securely; only a hash is kept.",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 100, example: "Local Development" } } },
            },
          },
        },
        responses: {
          "201": { description: "Created.", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyCreated" } } } },
          ...cookieErrors,
        },
      },
      get: {
        tags: ["API Keys"],
        summary: "List API keys",
        description: "Full keys are never returned.",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": {
            description: "The caller's keys, newest first.",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ApiKeySummary" } } } },
          },
          "401": cookieErrors["401"],
        },
      },
    },
    "/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        summary: "Revoke an API key",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "204": { description: "Revoked (idempotent)." },
          ...cookieErrors,
          "404": errorResponse("Key not found.", "NOT_FOUND", "API key not found."),
        },
      },
    },
    "/v1/audio/speech": {
      post: {
        tags: ["Audio"],
        summary: "Text to speech",
        description: "Generates speech with `sauti-v2` and returns the audio bytes directly.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SpeechRequest" } } } },
        responses: {
          "200": {
            description: "Generated audio.",
            content: {
              "audio/mpeg": { schema: { type: "string", format: "binary" } },
              "audio/wav": { schema: { type: "string", format: "binary" } },
            },
          },
          ...v1Errors,
          "501": errorResponse("`stream: true` is not supported yet.", "NOT_IMPLEMENTED", "Streaming speech generation is not yet supported."),
          "502": errorResponse("Generation failed.", "TTS_GENERATION_FAILED", "The text-to-speech service failed to process the request."),
          "503": errorResponse("TTS worker unavailable.", "TTS_UNAVAILABLE", "The text-to-speech service is currently unavailable."),
        },
      },
    },
    "/v1/audio/transcriptions": {
      post: {
        tags: ["Audio"],
        summary: "Speech to text",
        description: "Transcribes an uploaded audio file with `whisper-large-v3-turbo`.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file", "model"],
                properties: {
                  file: { type: "string", format: "binary", description: "wav, mp3, m4a, ogg, webm or flac." },
                  model: { type: "string", enum: [MODELS.stt], example: MODELS.stt },
                  language: { type: "string", example: "sw", description: "Optional ISO 639 code. Auto-detected when omitted." },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Transcript.", content: { "application/json": { schema: { $ref: "#/components/schemas/Transcription" } } } },
          ...v1Errors,
          "413": errorResponse("File too large.", "PAYLOAD_TOO_LARGE", "The uploaded file exceeds the size limit."),
          "415": errorResponse("Unsupported audio type.", "UNSUPPORTED_MEDIA_TYPE", "Unsupported audio type 'text/plain'."),
          "502": errorResponse("Transcription failed.", "STT_TRANSCRIPTION_FAILED", "The speech-to-text service failed to process the request."),
          "503": errorResponse("STT worker unavailable.", "STT_UNAVAILABLE", "The speech-to-text service is currently unavailable."),
        },
      },
    },
    "/v1/chat/completions": {
      post: {
        tags: ["Chat"],
        summary: "Chat completion",
        description: "Generates an assistant reply with `qwen3.5-4b`. Send prior turns in `messages` for conversation history.",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ChatRequest" } } } },
        responses: {
          "200": { description: "Completion.", content: { "application/json": { schema: { $ref: "#/components/schemas/ChatCompletion" } } } },
          ...v1Errors,
          "501": errorResponse("`stream: true` is not supported yet.", "NOT_IMPLEMENTED", "Streaming chat completions are not yet supported."),
          "502": errorResponse("Completion failed.", "SLM_COMPLETION_FAILED", "The language model service failed to process the request."),
          "503": errorResponse("SLM worker unavailable.", "SLM_UNAVAILABLE", "The language model service is currently unavailable."),
        },
      },
    },
  },
};
