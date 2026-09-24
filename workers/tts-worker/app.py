"""TTS worker (Sauti V2 on Chatterbox). Contract: POST /synthesize {text, voice, format} -> audio bytes.

UNVERIFIED: written without GPU access. The model card only documents loading the Chatterbox backbone;
the Sauti V2 LoRA adapter (`new_lang_adapter`) must be applied with the Chatterbox fine-tuning toolkit.
`load_adapter` below is the one place that must be completed and verified on a GPU machine.
Set SAUTI_APPLY_ADAPTER=false to run the plain Chatterbox backbone in the meantime.
"""
import io
import os
import time

import torch
import torchaudio as ta
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

ADAPTER_REPO = os.getenv("SAUTI_ADAPTER_REPO", "msingiai/sauti_tts_v2")
DEVICE = os.getenv("TTS_DEVICE", "cuda")

app = FastAPI(title="tts-worker")
model = None


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str = "default"
    format: str = Field(default="mp3", pattern="^(mp3|wav)$")


def load_adapter(backbone):
    """Apply the Sauti V2 LoRA adapter on top of the Chatterbox backbone. TODO: complete and verify on GPU."""
    from huggingface_hub import snapshot_download

    adapter_dir = snapshot_download(ADAPTER_REPO, token=os.getenv("HF_TOKEN") or None)
    raise NotImplementedError(
        f"Adapter downloaded to {adapter_dir}; apply `new_lang_adapter` using the Chatterbox fine-tuning toolkit."
    )


@app.on_event("startup")
def load_model() -> None:
    global model
    from chatterbox.tts import ChatterboxTTS

    backbone = ChatterboxTTS.from_pretrained(device=DEVICE)
    model = load_adapter(backbone) if os.getenv("SAUTI_APPLY_ADAPTER", "true") == "true" else backbone


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(503, "model not loaded")
    return {"status": "ok"}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    if model is None:
        raise HTTPException(503, "model not loaded")
    started = time.perf_counter()
    try:
        with torch.inference_mode():
            wav = model.generate(req.text)
    except Exception as exc:
        raise HTTPException(500, f"generation failed: {exc}") from exc
    if wav.numel() == 0:
        raise HTTPException(500, "empty generation")
    buf = io.BytesIO()
    ta.save(buf, wav.cpu(), model.sr, format=req.format)
    return Response(
        content=buf.getvalue(),
        media_type="audio/mpeg" if req.format == "mp3" else "audio/wav",
        headers={
            "X-Audio-Duration-Seconds": f"{wav.shape[-1] / model.sr:.3f}",
            "X-Generation-Seconds": f"{time.perf_counter() - started:.3f}",
        },
    )
