Kenyan Conversational AI — Developer Build Specification
Updated: 15 September 2026

1. Product objective
Build a production-ready Kenyan conversational AI platform that can listen to Kenyan speech, understand and generate natural English–Kiswahili code-switching, execute business actions through tools, and respond with natural speech.

The product must be usable by external developers through stable APIs and by end users through a simple web playground and realtime voice sessions. The initial market focus is Kenya, with English, Kiswahili and natural English–Kiswahili code-switching as the core language experience.

2. Product surfaces
The platform exposes four primary developer interfaces:
• POST /v1/audio/transcriptions — speech-to-text.
• POST /v1/chat/completions — language model and tool use.
• POST /v1/audio/speech — text-to-speech.
• WS /v1/realtime — full duplex realtime conversation.

The web product exposes:
• TTS playground: enter text, generate, listen and download.
• STT playground: upload/record audio and view transcript.
• Realtime playground: speak naturally and receive spoken responses.
• API keys, usage, request logs and documentation.

3. Core architecture
Client / Phone / WebRTC
→ API Gateway
→ Realtime Session Orchestrator
→ Streaming STT
→ Code-switching SLM
→ Tool Runtime
→ TTS
→ Streaming Audio Output

Supporting services:
• Authentication and API-key service.
• Usage metering and billing events.
• Session state and conversation logs.
• Model registry and version routing.
• Queue/scheduler for GPU workers.
• Metrics, traces, error reporting and alerts.
• Object storage for approved model assets and opt-in evaluation samples.

Model workers run independently from the public API. Each worker keeps its model resident in memory while active. The public API uses stable model IDs so model implementations can improve without changing customer integrations.

4. Initial model stack
TTS — MsingiAI Sauti TTS V2
Use msingiai/sauti_tts_v2 as the first hosted TTS model. It is a Swahili adaptation of Chatterbox Multilingual; the published model is distributed as a LoRA adapter and the relevant public model cards identify MIT licensing for Sauti V2 / Chatterbox. Package the complete inference dependency chain into one reproducible container.

Initial TTS engineering output:
• deterministic deployment image;
• warm inference worker;
• streaming and non-streaming generation;
• WAV and MP3 output;
• time-to-first-audio, realtime factor, VRAM and concurrency measurements;
• failure handling for empty, repeated or malformed generations.

STT — Whisper baseline
Use openai/whisper-large-v3-turbo as the initial deployable baseline. It is MIT-licensed and multilingual. Benchmark it specifically on Kenyan English, Kenyan Kiswahili, code-switching and telephony audio. Evaluate msingiai/sauti-asr as a Kenyan Swahili reference candidate; its public model card currently reports 13.72% WER and 3.88% CER on a Kenyan Swahili held-out set.

SLM — Qwen 3.5 4B baseline
Use Qwen/Qwen3.5-4B as the initial small language-model candidate. It is Apache-2.0 licensed and suitable for instruction following and tool-enabled application work. Benchmark it for Kenyan English/Kiswahili understanding, code-switch generation, structured outputs, tool calling and first-token latency.

5. Realtime conversation behavior
The realtime session must support:
• streaming microphone or telephony audio;
• voice activity detection and end-of-turn detection;
• partial and final transcripts;
• token streaming from the SLM;
• tool/function calls with structured JSON arguments;
• incremental TTS generation;
• interruption/barge-in that immediately stops current playback;
• session transcript and per-stage latency trace;
• reconnect and graceful failure behavior.

The main latency metric is end-of-user-turn to first returned audio. Also record STT partial latency, SLM first-token latency, TTS first-audio latency, queue time and total conversation cost per minute.

6. Tool runtime
The SLM must be able to call external functions without embedding business logic inside the model service.

Implement a tool contract with:
• tool name and description;
• JSON schema input;
• execution timeout;
• structured success/error result;
• audit log;
• session correlation ID.

Start with at least one demonstrable business action such as order lookup, appointment lookup or CRM record retrieval.

7. Kenyan quality benchmark
Create a frozen evaluation suite used for every model release.

Coverage:
• Kenyan English.
• Kenyan Kiswahili.
• Natural English–Kiswahili code-switching.
• Sheng examples where appropriate.
• Kenyan names, towns, companies and acronyms.
• Phone numbers, money, dates, times and addresses.
• Noisy and narrowband telephony audio.
• Business conversations and tool-use turns.

STT metrics:
WER/CER by language bucket, named-entity accuracy, number accuracy, streaming latency and failure rate.

SLM metrics:
task accuracy, tool-call accuracy, code-switch comprehension, response naturalness, format compliance and first-token latency.

TTS metrics:
native-listener naturalness, Kenyan accent authenticity, English pronunciation, Kiswahili pronunciation, switch naturalness, named-entity pronunciation, malformed-generation rate, realtime factor and time-to-first-audio.

8. Data and model improvement loop
Production feedback becomes a structured engineering loop:
usage → failure capture → classification → correction → evaluation set → targeted training data → new checkpoint → benchmark → deployment.

Quality samples used for training or long-term evaluation must be explicitly opted in or collected under appropriate rights. Maintain dataset provenance, speaker consent, language labels and version history.

9. Deployment and infrastructure
Use containerized services and GPU workers.

Recommended service split:
• api-gateway
• auth-service
• realtime-orchestrator
• stt-worker
• slm-worker
• tts-worker
• tool-runner
• metering-service
• postgres
• redis
• object-storage
• monitoring

Development and low-traffic environments can use on-demand/serverless GPU capacity. Production realtime traffic should move to warm workers when measured latency and traffic justify it.

Every model release must have:
• immutable model/version ID;
• container version;
• dependency lockfile;
• model/license manifest;
• benchmark report;
• rollback target.

10. API contract
Use OpenAI-style request shapes where practical.

TTS example:
POST /v1/audio/speech
Authorization: Bearer <api_key>

{
  "model": "sauti-v2",
  "input": "Nimefika office, I will call you nikimaliza meeting.",
  "voice": "default",
  "response_format": "mp3",
  "stream": true
}

Realtime sessions should expose events for:
session.created, input_audio, transcript.partial, transcript.final, response.text.delta, tool.call, tool.result, audio.delta, response.completed and error.

11. Delivery phases
Phase 1 — Hosted TTS
Deliver Sauti V2 as a reliable API and playground with authentication, metering and performance metrics.

Phase 2 — Full conversation alpha
Add streaming STT, SLM, tool calling and realtime voice. Demonstrate browser voice and one phone/SIP conversation.

Phase 3 — Kenyan evaluation system
Freeze the benchmark, run human listening tests and start structured production failure capture.

Phase 4 — Kenyan model adaptation
Adapt STT, SLM and TTS using measured failures and licensed Kenyan data. Keep the same public APIs while model versions improve.

Phase 5 — Production beta
Add warm/autoscaling workers, queues, retries, model routing, observability, quotas, billing and load testing.

Phase 6 — General availability
Enable self-service signup, payment, API keys, documentation, usage dashboards, production realtime sessions and phone integration.

12. Acceptance criteria
A release is production-ready when:
• an external developer can integrate from documentation alone;
• all four API surfaces are authenticated, metered and versioned;
• realtime sessions support interruption and tool calling;
• latency and error metrics are visible per request/session;
• the Kenyan benchmark is run for every candidate model release;
• model versions can be rolled back without API changes;
• billing events reconcile with measured usage;
• a customer can run a real Kenyan voice conversation end-to-end.

13. First engineering milestone
Deploy msingiai/sauti_tts_v2 on our GPU infrastructure and submit a benchmark report containing:
• exact GPU and VRAM use;
• cold-start and warm-start time;
• time to first audio;
• realtime factor;
• stable concurrency;
• error/retry rate;
• generated-audio cost per minute;
• results on a fixed Kenyan text prompt set.

Once this is stable, expose /v1/audio/speech and the public playground, then proceed directly to the realtime STT → SLM → TTS loop.

14. Technical references
Msingi Sauti TTS V2: https://huggingface.co/msingiai/sauti_tts_v2
Msingi Sauti ASR: https://huggingface.co/msingiai/sauti-asr
Whisper Large V3 Turbo: https://huggingface.co/openai/whisper-large-v3-turbo
Qwen 3.5 4B: https://huggingface.co/Qwen/Qwen3.5-4B
Chatterbox: https://huggingface.co/ResembleAI/chatterbox

