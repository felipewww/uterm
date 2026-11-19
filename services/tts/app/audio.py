"""Normalise an uploaded reference clip to mono 24 kHz PCM16 WAV (max 30 s)."""
from __future__ import annotations

import io

MIN_SECONDS = 3.0
MAX_SECONDS = 30.0


def normalise_reference(raw: bytes) -> bytes:
    import librosa
    import soundfile as sf

    try:
        y, sr = librosa.load(io.BytesIO(raw), sr=24000, mono=True)
    except Exception as exc:  # decoder errors vary by backend
        raise ValueError(f"unreadable audio: {exc}") from exc
    if len(y) / sr < MIN_SECONDS:
        raise ValueError(f"reference must be at least {MIN_SECONDS:.0f} seconds")
    y = y[: int(MAX_SECONDS * sr)]
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
