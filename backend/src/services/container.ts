import { env } from "../config/env";
import { PipelineService } from "./pipeline/pipeline.service";
import { SlmService } from "./slm/slm.service";
import { MockSlmProvider } from "./slm/mock-slm.provider";
import { QwenSlmProvider } from "./slm/qwen-slm.provider";
import type { SlmProvider } from "./slm/slm.provider";
import { SpeechService } from "./speech.service";
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

export function createProvidersFromEnv(): Providers {
  return {
    stt:
      env.STT_PROVIDER === "mock"
        ? new MockSttProvider()
        : new WhisperSttProvider(env.STT_SERVICE_URL, env.STT_SERVICE_TIMEOUT_MS),
    slm:
      env.SLM_PROVIDER === "mock"
        ? new MockSlmProvider()
        : new QwenSlmProvider(env.SLM_SERVICE_URL, env.SLM_SERVICE_TIMEOUT_MS),
    tts:
      env.TTS_PROVIDER === "mock"
        ? new MockTtsProvider()
        : new SautiTtsProvider(env.TTS_SERVICE_URL, env.TTS_SERVICE_TIMEOUT_MS),
  };
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
