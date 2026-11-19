from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from .engine import DEFAULT_VOICE_ID, ChatterboxEngine
from .voices import MAX_UPLOAD_BYTES, VoiceStore

MAX_TEXT_CHARS = 600
MAX_PENDING = 6


class SynthRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    voice_id: str = DEFAULT_VOICE_ID


class State:
    engine = None
    store: VoiceStore
    ready = False
    error: Optional[str] = None
    pending = 0
    lock = threading.Lock()


state = State()


def _load_engine(engine) -> None:
    try:
        engine.load()
        for v in state.store.list():  # restore saved voices lazily-but-eagerly
            try:
                engine.prepare_voice(v.id, str(state.store.ref_path(v.id)))
            except Exception as exc:
                print(f"voice {v.id} failed to prepare: {exc}", flush=True)
        try:  # first real synthesis pays one-off warm-up costs (kernel loading, allocator); do it before /ready
            engine.synthesize("Ready.", DEFAULT_VOICE_ID)
        except Exception as exc:
            print(f"warm-up failed (continuing): {exc}", flush=True)
        state.ready = True
    except Exception as exc:  # surfaced via /ready
        state.error = f"{type(exc).__name__}: {exc}"
        print("engine load failed:", state.error, flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.store = VoiceStore(Path(os.environ.get("VOICES_DIR", "/voices")))
    if state.engine is None:  # tests inject a fake engine before startup
        state.engine = ChatterboxEngine(device=os.environ.get("TTS_DEVICE", "cpu"))
    threading.Thread(target=_load_engine, args=(state.engine,), daemon=True).start()
    yield


app = FastAPI(title="echo-term TTS", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ready")
def ready(response: Response):
    if not state.ready:
        response.status_code = 503
        return {"ready": False, "error": state.error}
    return {"ready": True, "sample_rate": state.engine.sample_rate,
            "load_seconds": getattr(state.engine, "load_seconds", 0.0)}


@app.get("/voices")
def list_voices():
    return {"voices": [{"id": DEFAULT_VOICE_ID, "name": "Default"}]
            + [{"id": v.id, "name": v.name} for v in state.store.list()]}


@app.post("/voices", status_code=201)
async def create_voice(name: str = Form(...), file: UploadFile = File(...)):
    if not state.ready:
        raise HTTPException(503, "model not ready")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large")
    from .audio import normalise_reference

    try:
        wav = normalise_reference(raw)
        voice = state.store.create(name, wav)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    try:
        state.engine.prepare_voice(voice.id, str(state.store.ref_path(voice.id)))
    except Exception as exc:
        state.store.delete(voice.id)
        raise HTTPException(500, f"could not prepare voice: {exc}")
    return {"id": voice.id, "name": voice.name}


@app.delete("/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str):
    if voice_id == DEFAULT_VOICE_ID:
        raise HTTPException(400, "the default voice cannot be deleted")
    try:
        found = state.store.delete(voice_id)
    except ValueError:
        raise HTTPException(422, "invalid voice id")
    if not found:
        raise HTTPException(404, "unknown voice")
    state.engine.forget_voice(voice_id)
    return Response(status_code=204)


@app.post("/synthesize")
def synthesize(req: SynthRequest):
    if not state.ready:
        raise HTTPException(503, "model not ready")
    if not state.engine.has_voice(req.voice_id):
        raise HTTPException(404, "unknown voice")
    with state.lock:
        if state.pending >= MAX_PENDING:
            raise HTTPException(429, "too many pending requests")
        state.pending += 1
    try:
        audio, gen_seconds = state.engine.synthesize(req.text, req.voice_id)
    finally:
        with state.lock:
            state.pending -= 1
    seconds = (len(audio) - 44) / 2 / state.engine.sample_rate
    return Response(audio, media_type="audio/wav", headers={
        "X-Gen-Seconds": f"{gen_seconds:.3f}",
        "X-Audio-Seconds": f"{seconds:.3f}",
    })
