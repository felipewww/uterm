"""Chatterbox Turbo wrapper: one shared model, per-voice cached conditioning."""
from __future__ import annotations

import io
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional, Protocol

DEFAULT_VOICE_ID = "default"


class Engine(Protocol):
    sample_rate: int

    def load(self) -> None: ...
    def prepare_voice(self, voice_id: str, wav_path: str) -> None: ...
    def forget_voice(self, voice_id: str) -> None: ...
    def synthesize(self, text: str, voice_id: str) -> tuple[bytes, float]: ...


@dataclass
class ChatterboxEngine:
    device: str = "cpu"
    sample_rate: int = 24000
    _model: Any = None
    _conds: dict[str, Any] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)
    load_seconds: float = 0.0

    def load(self) -> None:
        import torch

        threads = int(os.environ.get("TTS_TORCH_THREADS", "4"))
        torch.set_num_threads(threads)
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        t0 = time.perf_counter()
        self._model = ChatterboxTurboTTS.from_pretrained(device=self.device)
        self.sample_rate = self._model.sr
        # Built-in default voice = the conditioning shipped with the model.
        self._conds[DEFAULT_VOICE_ID] = self._model.conds
        self.load_seconds = time.perf_counter() - t0

    def prepare_voice(self, voice_id: str, wav_path: str) -> None:
        with self._lock:
            self._model.prepare_conditionals(wav_path)
            self._conds[voice_id] = self._model.conds

    def forget_voice(self, voice_id: str) -> None:
        self._conds.pop(voice_id, None)

    def has_voice(self, voice_id: str) -> bool:
        return voice_id in self._conds

    def synthesize(self, text: str, voice_id: str) -> tuple[bytes, float]:
        import soundfile as sf

        with self._lock:
            # Always assign the requested voice's own conditioning so one
            # session's voice never leaks into another's.
            self._model.conds = self._conds[voice_id]
            t0 = time.perf_counter()
            wav = self._model.generate(text)
            gen = time.perf_counter() - t0
        buf = io.BytesIO()
        sf.write(buf, wav.squeeze().cpu().numpy(), self.sample_rate, format="WAV", subtype="PCM_16")
        return buf.getvalue(), gen
