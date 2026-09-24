"""STT worker (Whisper large-v3-turbo). Contract: POST /transcribe (multipart: file, language?) -> {text, language}."""
import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

# faster-whisper's CTranslate2 build of openai/whisper-large-v3-turbo
MODEL_NAME = os.getenv("STT_MODEL", "large-v3-turbo")
DEVICE = os.getenv("STT_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "float16")

app = FastAPI(title="stt-worker")
model: WhisperModel | None = None


@app.on_event("startup")
def load_model() -> None:
    global model
    model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE)


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(503, "model not loaded")
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str | None = Form(None)):
    if model is None:
        raise HTTPException(503, "model not loaded")
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    suffix = os.path.splitext(file.filename or "")[1] or ".audio"
    with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
        tmp.write(data)
        tmp.flush()
        try:
            segments, info = model.transcribe(tmp.name, language=language, vad_filter=True)
            text = " ".join(s.text.strip() for s in segments).strip()
        except Exception as exc:  # undecodable audio etc.
            raise HTTPException(500, f"transcription failed: {exc}") from exc
    return {"text": text, "language": info.language}
