"""SLM worker (Qwen3.5-4B). Contract: POST /complete {messages, temperature?, max_tokens?, response_format?} -> {content}.

UNVERIFIED: written without GPU access. Confirm the correct transformers auto-class for Qwen3.5 on first run.
"""
import json
import os
import re

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_ID = os.getenv("SLM_MODEL", "Qwen/Qwen3.5-4B")
DEFAULT_MAX_TOKENS = int(os.getenv("SLM_MAX_TOKENS", "512"))

app = FastAPI(title="slm-worker")
tokenizer = None
model = None


class Message(BaseModel):
    role: str
    content: str


class CompleteRequest(BaseModel):
    messages: list[Message]
    temperature: float | None = None
    max_tokens: int | None = None
    response_format: str | None = None


@app.on_event("startup")
def load_model() -> None:
    global tokenizer, model
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16, device_map="auto")


@app.get("/health")
def health():
    if model is None:
        raise HTTPException(503, "model not loaded")
    return {"status": "ok"}


@app.post("/complete")
def complete(req: CompleteRequest):
    if model is None or tokenizer is None:
        raise HTTPException(503, "model not loaded")
    messages = [m.model_dump() for m in req.messages]
    if req.response_format == "json_object":
        messages.insert(0, {"role": "system", "content": "Respond with a single valid JSON object and nothing else."})
    # Thinking mode is disabled: it adds seconds of latency a voice loop cannot afford.
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    temperature = req.temperature if req.temperature is not None else 0.7
    output = model.generate(
        **inputs,
        max_new_tokens=req.max_tokens or DEFAULT_MAX_TOKENS,
        do_sample=temperature > 0,
        temperature=temperature if temperature > 0 else None,
    )
    content = tokenizer.decode(output[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()
    if req.response_format == "json_object":
        match = re.search(r"\{.*\}", content, re.DOTALL)
        candidate = match.group(0) if match else content
        try:
            json.loads(candidate)
            content = candidate
        except ValueError:
            pass  # the API layer reports SLM_COMPLETION_FAILED
    return {"content": content}
