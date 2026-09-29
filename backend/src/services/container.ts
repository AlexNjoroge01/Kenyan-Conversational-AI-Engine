import { env } from "../config/env";
import { PipelineService } from "./pipeline/pipeline.service";
import { SlmService } from "./slm/slm.service";
import { MockSlmProvider } from "./slm/mock-slm.provider";
import { OpenAiCompatibleSlmProvider } from "./slm/openai-compatible-slm.provider";
import { QwenSlmProvider } from "./slm/qwen-slm.provider";
import type { SlmProvider } from "./slm/slm.provider";
import { SpeechService } from "./speech.service";
import { GroqSttProvider } from "./stt/groq-stt.provider";
import { MockSttProvider } from "./stt/mock-stt.provider";
import type { SttProvider } from "./stt/stt.provider";
import { SttService } from "./stt/stt.service";
import { WhisperSttProvider } from "./stt/whisper-stt.provider";
import { MockTtsProvider } from "./tts/mock-tts.provider";
import { SautiTtsProvider } from "./tts/sauti-tts.provider";
import type { TtsProvider } from "./tts/tts.provider";
import { TtsService } from "./tts/tts.service";

export interface Providers {
  stt: SttProvider;
  slm: SlmProvider;
  tts: TtsProvider;
}

export interface Services {
  stt: SttService;
  slm: SlmService;
  tts: TtsService;
  speech: SpeechService;
  pipeline: PipelineService;
}

function createSttProvider(): SttProvider {
  switch (env.STT_PROVIDER) {
    case "mock":
      return new MockSttProvider();
    case "groq":
      return new GroqSttProvider({
        apiKey: env.GROQ_API_KEY!,
        model: env.GROQ_STT_MODEL,
        baseUrl: env.GROQ_BASE_URL,
        timeoutMs: env.STT_TIMEOUT_MS,
      });
    case "http":
      return new WhisperSttProvider({
        baseUrl: env.STT_SERVICE_URL,
        timeoutMs: env.STT_TIMEOUT_MS,
        workerApiKey: env.WORKER_API_KEY,
      });
  }
}

function createSlmProvider(): SlmProvider {
  switch (env.SLM_PROVIDER) {
    case "mock":
      return new MockSlmProvider();
    case "openai-compatible":
      return new OpenAiCompatibleSlmProvider({
        baseUrl: env.SLM_BASE_URL!,
        apiKey: env.SLM_API_KEY,
        model: env.SLM_MODEL!,
        timeoutMs: env.SLM_SERVICE_TIMEOUT_MS,
        disableThinking: env.SLM_DISABLE_THINKING,
      });
    case "http":
      return new QwenSlmProvider({
        baseUrl: env.SLM_SERVICE_URL,
        timeoutMs: env.SLM_SERVICE_TIMEOUT_MS,
        workerApiKey: env.WORKER_API_KEY,
      });
  }
}

function createTtsProvider(): TtsProvider {
  switch (env.TTS_PROVIDER) {
    case "mock":
      return new MockTtsProvider();
    case "http":
      return new SautiTtsProvider({
        baseUrl: env.TTS_SERVICE_URL,
        timeoutMs: env.TTS_SERVICE_TIMEOUT_MS,
        workerApiKey: env.WORKER_API_KEY,
      });
  }
}

export function createProvidersFromEnv(): Providers {
  return { stt: createSttProvider(), slm: createSlmProvider(), tts: createTtsProvider() };
}

export function createServices(providers: Providers): Services {
  const stt = new SttService(providers.stt);
  const slm = new SlmService(providers.slm);
  const tts = new TtsService(providers.tts);
  return {
    stt,
    slm,
    tts,
    speech: new SpeechService(tts),
    pipeline: new PipelineService(stt, slm, tts),
  };
}
