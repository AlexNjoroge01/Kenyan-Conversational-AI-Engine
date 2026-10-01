# Kaggle GPU worker (Sauti V2 TTS + Qwen3.5-4B)

Two notebooks:
- **`kenya_engine_worker.ipynb`** runs both self-hosted models on Kaggle's free **GPU T4 ×2**. It serves them as one FastAPI app behind your **ngrok static domain**, so the API on Render can call it.
- **`export_weights.ipynb`** (optional, run once on CPU) saves the ~13 GB of model weights as a Kaggle input, so the worker doesn't re-download them every session. See [Cache the weights](#cache-the-weights-skip-the-13-gb-download).

```
Vercel (Next.js) ──► Render (Express API) ──► https://<NGROK_DOMAIN> ──► Kaggle notebook
                          │                                               ├─ cuda:0  Sauti V2 (Chatterbox + LoRA), fp32
                          └─► Groq (Whisper Large V3 Turbo)               └─ cuda:1  Qwen3.5-4B, fp16, text-only
```

| Route | Auth | Contract |
|---|---|---|
| `GET /health` | none | `{"status": "ok" \| "degraded" \| "unavailable", "models": {"tts": bool, "slm": bool}}` |
| `POST /synthesize` | `X-Worker-Key` | `{text, voice: "default", format: "wav" \| "mp3"}` → audio bytes (`audio/wav`, or `audio/mpeg` when MP3 encoding is available), headers `X-Audio-Duration-Seconds`, `X-Generation-Seconds` |
| `POST /complete` | `X-Worker-Key` | `{messages, temperature?, max_tokens?, response_format?}` → `{"content": "..."}` (thinking disabled; `<think>` stripped) |

Errors are always JSON: `{"error": {"code": "...", "message": "..."}}`.

| Status | Code | When |
|---|---|---|
| 400 | `EMPTY_INPUT`, `VALIDATION_ERROR`, `UNSUPPORTED_VOICE` | bad request |
| 401 | `UNAUTHORIZED` | missing or wrong `X-Worker-Key` (constant-time comparison) |
| 413 | `INPUT_TOO_LONG`, `CONTEXT_TOO_LONG` | over 1,000 TTS characters, or over the 8K-token context |
| 500 | `GENERATION_FAILED`, `EMPTY_GENERATION` | the model failed or produced nothing usable |
| 503 | `MODEL_NOT_LOADED`, `GPU_OUT_OF_MEMORY` | model failed to load, or CUDA OOM (the cache is cleared; retry) |

The backend maps these to its public codes (`TTS_UNAVAILABLE`, `SLM_COMPLETION_FAILED`, …). Worker details never reach API clients.

## One-time setup (already done)

- Kaggle account phone-verified (needed for GPU and Internet).
- Secrets under **Add-ons → Secrets**, attached to this notebook, with exactly these names: `HF_TOKEN`, `NGROK_TOKEN`, `NGROK_DOMAIN` (e.g. `xyz.ngrok-free.app`), `WORKER_API_KEY` (at least 16 characters, and the same value as on Render).

## Import and configure

1. On Kaggle: **Create → New Notebook**, then **File → Import Notebook** and upload `kenya_engine_worker.ipynb`.
2. In the right-hand panel, **Settings**: **Accelerator → GPU T4 x2** and **Internet → On**.
3. **Add-ons → Secrets**: tick **Attached** for all four secrets. The first cell fails fast, naming any that are missing.

## Run it

### A. Interactive (testing): Run All

**Run All**. The cells:

| Cell | What it does | First run |
|---|---|---|
| 1 | `nvidia-smi`, checks for 2 GPUs and that all four secrets are present (names only are printed) | seconds |
| 2 | installs pinned dependencies and prints their versions | a few minutes |
| 3 | configuration (devices, pinned model revisions, limits) | instant |
| 3b | looks for an attached weights bundle in `/kaggle/input` (see [Cache the weights](#cache-the-weights-skip-the-13-gb-download)) | instant |
| 4 | gets Chatterbox (3.2 GB) and the Sauti adapter (0.4 GB) from the bundle or Hugging Face, rebuilds T3 with the 2,454-token vocabulary, applies and merges the LoRA, **verifies the adapter really applied**, warm-up | several minutes (much less with the bundle) |
| 5 | gets Qwen3.5-4B (9.3 GB) the same way and loads it text-only in fp16 on `cuda:1` | several minutes (much less with the bundle) |
| 6 | builds the FastAPI app | instant |
| 7 | starts uvicorn in a background thread and opens the ngrok tunnel on your domain, then checks the public `/health` | seconds |
| 8 | **smoke test**: English, Kiswahili and code-switched speech (*"Nimefika office, I will call you nikimaliza meeting."*) saved as `/kaggle/working/smoke_*.wav`, one Kiswahili chat turn, and one unauthenticated request (must return 401). Prints per-request latency, real-time factor and peak VRAM | about a minute |
| 9 | keeps the worker alive and prints a heartbeat (request counts, VRAM) every 10 minutes | runs until stopped |

The worker stays up while the interactive session is open. Kaggle stops idle interactive sessions, so use B for anything longer than a test.

If one model fails to load, the other is still served: `/health` shows `"degraded"`, and the broken route returns `503 MODEL_NOT_LOADED`. The cell output shows the error, with secrets masked.

### B. Background: Save Version → Save & Run All (Commit)

1. **Stop the interactive session first.** Only one agent can hold your ngrok static domain at a time.
2. **Save Version** (top right) → **Save & Run All (Commit)** → **Save**.
3. The committed run executes every cell headlessly. Cell 9 keeps it serving until you stop it or Kaggle's 12-hour GPU session limit ends it. Because the loop never finishes, the version ends as *timed out* or *cancelled*; that is expected. Commit again to restart.
4. Follow it from the notebook's **Versions** list: open the running version to see the log. Cancel the run from there to stop the worker.
5. The smoke-test results are in the log. Kaggle keeps a version's output files (the WAVs) only for runs that complete, so listen to the WAVs from an interactive run (A).

Every hour the notebook runs counts against your weekly Kaggle GPU quota (about 30 hours, varying week to week), whether committed or interactive. Stop it when you're not using it.

## Cache the weights (skip the 13 GB download)

> **Optional, and a backup rather than the main path.** The default, and the recommended first run, is the plain Hugging Face download: no setup, and always the exact pinned revisions. Add this cache only once the worker runs cleanly. If the cache is missing, stale or incomplete, the worker simply downloads instead, so it can make startup faster but never break it.

Kaggle sessions start with an empty disk, so without a cache every session downloads all ~13 GB from Hugging Face. That adds roughly 5–10 minutes to startup, and those minutes count against your GPU hours. The downloads happen on Kaggle's servers, not your machine or Render.

To download them once and reuse them:

**1. Export the weights once (CPU, no GPU hours)**
1. Kaggle: **Create → New Notebook**, then **File → Import Notebook** and upload `workers/kaggle/export_weights.ipynb`. Name it e.g. `kenya-engine-weights-export`.
2. Settings: **Accelerator → None**, **Internet → On**. Attaching the `HF_TOKEN` secret is optional; the repos are public.
3. **Save Version → Save & Run All (Commit)**. It downloads the pinned weights into its output as `kenya-engine-weights/`, with a `MANIFEST.json` recording each repo and revision. Wait for the version to show **complete**. Kaggle keeps output only from runs that finish, which is why this is a separate notebook.

**2. Attach it to the worker**
1. Open `kenya_engine_worker` → right panel → **Add Input** → **Your Work** → **Notebooks** → pick the export notebook → **Add**.
2. Run the worker. Cell 3b should print `Weights bundle attached at /kaggle/input/…`, and Cells 4 and 5 print `[weights] … using attached bundle`. The smoke test ends with `Weights loaded from: {'chatterbox': 'kaggle-input', 'sauti': 'kaggle-input', 'qwen': 'kaggle-input'}`.

Optional: from the export version's **Output** tab, create a private **Dataset** from the files, and attach that instead with **Add Input → Datasets**. The worker finds the bundle either way, whether it sits in a `kenya-engine-weights/` folder or its contents are at the dataset's root.

**How the worker decides:** for each model it uses the attached bundle only if the manifest has **exactly** the pinned repo and revision **and** every required file (including every Qwen shard in the index) is present. Otherwise it logs why and downloads that model from Hugging Face. A stale or partial bundle can never load the wrong weights; it only makes startup slower.

**When the pins change:** if you bump a revision in Cell 3 of the worker, bump it the same way in Cell 2 of `export_weights.ipynb`, re-run the export (Save & Run All), and the attached input picks up the new version. The two notebooks must pin identical repos, revisions and file patterns.

Sizes: bundle ≈ 12.9 GB (Qwen 9.3, Chatterbox 3.2, Sauti adapter 0.4). That fits within Kaggle's 20 GB output limit.

## Verify

From any machine:

```bash
curl https://<NGROK_DOMAIN>/health
# {"status":"ok","models":{"tts":true,"slm":true}}

# Authenticated TTS (use your WORKER_API_KEY; never commit it)
curl https://<NGROK_DOMAIN>/synthesize \
  -H "X-Worker-Key: $WORKER_API_KEY" -H "ngrok-skip-browser-warning: true" \
  -H "Content-Type: application/json" \
  -d '{"text":"Nimefika office, I will call you nikimaliza meeting.","voice":"default","format":"wav"}' \
  --output test.wav

# Authenticated chat
curl https://<NGROK_DOMAIN>/complete \
  -H "X-Worker-Key: $WORKER_API_KEY" -H "ngrok-skip-browser-warning: true" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Habari! Unaweza kunisaidia?"}]}'

# Without the key: 401
curl -i -X POST https://<NGROK_DOMAIN>/complete -H "Content-Type: application/json" -d '{"messages":[]}'
```

Then check the API end to end: `GET https://kenyan-conversational-ai-engine.onrender.com/ready` should report `tts` and `slm` as `ok`. See `backend/README.md` → *Deployment*.

## Measured on Kaggle (2× T4), 29 Sep 2026

The first full run: every smoke test passed, with weights downloaded from Hugging Face (no cache attached). Environment: torch 2.10.0+cu128, transformers 5.2.0, peft 0.19.1, chatterbox-tts 0.1.7, torchao uninstalled.

| Metric | Sauti V2 (`cuda:0`, fp32) | Qwen3.5-4B (`cuda:1`, fp16) |
|---|---|---|
| Load (cold) | 30.4 s, plus an 11.0 s warm-up generation | 14.6 s |
| VRAM | 3.1 GiB allocated (3.2 GiB peak while generating) of 15 GiB | 7.8 GiB allocated (7.9 GiB peak) of 15 GiB |
| Latency | English 5.0 s for 4.0 s of audio (RTF 1.25); Kiswahili 5.4 s / 5.0 s (RTF 1.07); code-switched 3.6 s / 3.2 s (RTF 1.14) | 4.0–4.7 s for a short Kiswahili customer-service reply (≤128 new tokens) |
| Sampling speed | ~32 speech tokens/s | |

What this means:
- **TTS runs at about real time.** A request takes roughly as long as the audio it produces, so the API's `TTS_MAX_INPUT_CHARACTERS=500` (≈30–40 s of speech) stays well inside the 120 s timeout.
- **There is VRAM headroom on both GPUs.**
- **Correction (1 Oct 2026): the `alignment_stream_analyzer` warnings were a bug, not a safety net.** ("Detected 2x repetition … forcing EOS token".) Chatterbox enables that analyzer for *any* 2,454-token vocabulary, so Sauti got the multilingual model's guard. Its token-repetition rule ends speech whenever two consecutive speech tokens match, which is normal in pauses and long vowels. In live voice conversations that cut replies short or left them silent. The worker now disables it (`TTS_ALIGNMENT_GUARD = False`); see [Speech cut off or silent](#speech-cut-off-or-silent).
- **The Kiswahili replies are understandable but not always idiomatic.** Track that in the Kenyan evaluation set (spec §7), not as a bug.

## How Sauti V2 is loaded (and why not like the reference Space)

`msingiai/sauti_tts_v2` is a PEFT LoRA (r=128, alpha=256) on Chatterbox's **T3** module. It targets the Llama projections plus `spkr_enc`, and it also carries fully retrained `text_emb`/`text_head` for a 2,454-token multilingual grapheme vocabulary. The adapter's `adapter_config.json` points at the [chatterbox-finetuning](https://github.com/gokhaneraslan/chatterbox-finetuning) toolkit's T3, and the notebook reproduces that toolkit's `inference.py` / `merge_lora.py` in standard (non-Turbo) mode:

1. Load English Chatterbox (`ResembleAI/chatterbox`), with `grapheme_mtl_merged_expanded_v1.json` as `tokenizer.json`, as the toolkit's `setup.py` does.
2. Build a new T3 with `text_tokens_dict_size = 2454` and copy the base weights across (`resize_and_load_t3_weights`).
3. `PeftModel.from_pretrained(t3, "new_lang_adapter")`, then `merge_and_unload()`.
4. Generate with the stock `ChatterboxTTS.generate` (same tokenisation as training: `punc_norm` + `EnTokenizer`, no language tag).

The public Space `Stanley-09/msingi-ai-sauti-tts-lightweight` was checked as a reference, but its approach is **not** used, for three reasons:
- It is in `BUILD_ERROR`.
- It calls `model.model.load_adapter(...)`. `ChatterboxTTS` has no `.model` attribute, so that call fails.
- It catches the exception and keeps serving the base English model.

The notebook instead checks that the loaded `text_emb`/`text_head` equal the adapter's weights and that the LoRA changed the attention weights. It refuses to serve TTS otherwise.

The vendored chatterbox code in the toolkit matches the `chatterbox-tts==0.1.7` PyPI release, apart from training-only helpers. That release targets `transformers==5.2.0`, the first release with Qwen3.5 support, which is why both models can share one environment.

## Configuration (Cell 3)

| Setting | Default | Notes |
|---|---|---|
| `TTS_MAX_CHARS` | 1000 | keep the API's `TTS_MAX_INPUT_CHARACTERS` at or below this |
| `TTS_CHUNK_CHARS` | 150 | text is split at sentence boundaries into chunks of about 3–10 s of speech (like Sauti's training clips); chunks are joined with a 0.2 s pause |
| `TTS_ALIGNMENT_GUARD` | `False` | Chatterbox's multilingual alignment analyzer. Off because it cut Sauti's speech short; `True` only to experiment |
| `TTS_MAX_ATTEMPTS` | 2 | a chunk whose audio is empty or implausibly short or long is generated again; the attempt closest to a natural speaking rate is kept |
| `TTS_CHARS_PER_SECOND` | (5, 25) | plausible speaking rate, used for the retry decision and the smoke test's cut-off check |
| `TTS_PARAMS` | temperature 0.8, repetition penalty 1.2, cfg 0.5, exaggeration 0.5 | the toolkit's LoRA inference settings |
| `REFERENCE_VOICE_WAV` | `None` (Chatterbox's built-in voice) | path to a clean 5–10 s clip to use another voice, e.g. from an attached Kaggle dataset |
| `TRIM_TRAILING_SILENCE` | `True` | Silero VAD trims trailing noise and hallucinations, as the toolkit does |
| `SLM_DTYPE` | `float16` | T4 has no fast bf16 |
| `SLM_MAX_CONTEXT_TOKENS` | 8192 | prompt plus new tokens; longer conversations get `413 CONTEXT_TOO_LONG` |
| `SLM_DEFAULT_MAX_NEW_TOKENS` / `SLM_MAX_NEW_TOKENS` | 512 / 1024 | |
| Model revisions | pinned commit SHAs | bump them deliberately |

## Speech cut off or silent

In live voice conversations, Sauti sometimes spoke only part of the reply, or nothing at all. Causes and fixes (1 Oct 2026):

| Cause | Fix in the worker |
|---|---|
| Chatterbox enables its multilingual `AlignmentStreamAnalyzer` because Sauti's vocabulary has 2,454 tokens (`T3Config.is_multilingual` is just a vocabulary-size check). Its rule "two identical speech tokens in a row → end speech now" fires on ordinary pauses and long vowels | disabled for Sauti (`TTS_ALIGNMENT_GUARD = False`). Sauti uses the English model's normal stopping behaviour, and Cell 4 checks the setting applied |
| One bad chunk (forced end after a token or two) made the whole request fail as `EMPTY_GENERATION`, so nothing was spoken | each chunk is retried (`TTS_MAX_ATTEMPTS`) when its audio is empty or implausibly short or long for its text; the attempt closest to a natural speaking rate is kept |
| Chat replies contain line breaks (the tokenizer drops them and glues the words together), markdown symbols (spoken as noise) and emoji (unknown tokens) | `prepare_tts_text` turns line breaks into sentence breaks, strips markdown, and drops characters the tokenizer doesn't know |
| Long chunks (up to 250 characters) were far longer than Sauti's 3–10 s training clips | chunks are now at most 150 characters, split at sentence boundaries |

Cell 8's smoke test now includes a chat-style reply and checks the speaking rate: a reply spoken much faster than ~25 characters/second means words were dropped, and is reported as `FAIL (cut short or runaway?)`. The worker log prints one line per chunk (`[tts] chunk N chars -> X s audio, K attempt(s)`), never the text itself.

**Also check the API limit.** If a chat reply is longer than the API's `TTS_MAX_INPUT_CHARACTERS` (500 on Render), `/v1/audio/speech` rejects it with `400 VALIDATION_ERROR` and nothing is spoken. The fix is either a voice prompt with shorter replies (`max_tokens` ≈ 120), or raising the limit up to the worker's 1,000. At the measured RTF of ~1.1, 1,000 characters (~75 s of speech) takes ~85 s, inside the 120 s timeout.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing Kaggle secrets: …` | add or attach the named secrets (exact names), then restart the session |
| `Expected 2 GPUs` | Settings → Accelerator → **GPU T4 x2** |
| pip resolver warnings in Cell 2 | expected: Kaggle's preinstalled packages pin other versions. Only the printed versions of `transformers` (5.2.0), `chatterbox-tts` (0.1.7) and `peft` matter |
| Cell 4: `ImportError: Found an incompatible version of torchao … only versions above 0.16.0` | Kaggle's preinstalled `torchao` 0.10 trips PEFT while applying the LoRA. Cell 2 now uninstalls it (nothing here uses it), and Cell 2 should print `torchao: not installed`. In a session started with an older copy of the notebook, run `%pip uninstall -y torchao`, then re-run Cell 4 |
| Speech cut off, or nothing spoken | see [Speech cut off or silent](#speech-cut-off-or-silent). If the log still shows `forcing EOS token`, the session is running an older copy of the notebook: re-import it |
| `Sauti adapter was not applied …` | the adapter didn't match the rebuilt T3; TTS is disabled rather than serving the wrong voice. Report the Cell 4 output |
| `WARNING: the Perth implicit watermarker is unavailable` | the watermarking dependency failed to import, so audio is served **without** Chatterbox's watermark. Report the Cell 2 output |
| Qwen replies empty or garbled, or `GENERATION_FAILED` with inf/nan in the log | fp16 overflow. Try `SLM_DTYPE = "bfloat16"` (emulated on T4 and slower). Or switch the API to the hosted fallback (`SLM_PROVIDER=openai-compatible`) |
| Cell 7: `WARNING: … /health through the tunnel did not answer with the worker's JSON` (older copies crashed with `JSONDecodeError`) | ngrok answered with its own HTML error page, usually because the check ran before the tunnel was live. The server and tunnel are running anyway; re-run `check_public_health()`. If it persists, the printed `ngrok-error-code` says why: `ERR_NGROK_3200` tunnel offline, `ERR_NGROK_8012` ngrok can't reach the local server, `ERR_NGROK_334` domain in use by another session |
| `ngrok failed to start` / endpoint already online | another session (interactive or committed) holds the domain. Stop it, then re-run Cell 7 |
| `/health` works but the API still says `*_UNAVAILABLE` | `WORKER_API_KEY` differs between Kaggle and Render; the API logs "rejected our credentials" |
| Slow startup every session | attach the weights bundle ([Cache the weights](#cache-the-weights-skip-the-13-gb-download)) |
| `[weights] … downloading instead` although the bundle is attached | the log says why: a revision mismatch (re-run the export after bumping pins) or missing files (the export didn't finish, so check the version completed) |
| Very slow first request | model warm-up. Later requests are faster |
