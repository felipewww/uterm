import io
import struct

import pytest
from fastapi.testclient import TestClient

from app import main


class FakeEngine:
    sample_rate = 24000
    load_seconds = 0.0

    def __init__(self):
        self.voices = {"default"}
        self.last_voice = None

    def load(self): pass
    def prepare_voice(self, vid, path): self.voices.add(vid)
    def forget_voice(self, vid): self.voices.discard(vid)
    def has_voice(self, vid): return vid in self.voices

    def synthesize(self, text, vid):
        self.last_voice = vid
        pcm = b"\x00\x00" * 2400
        hdr = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16) + b"data" + struct.pack("<I", len(pcm))
        return hdr + pcm, 0.01


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("VOICES_DIR", str(tmp_path))
    main.state.engine = FakeEngine()
    main.state.ready = False
    with TestClient(main.app) as c:
        import time
        for _ in range(50):
            if main.state.ready: break
            time.sleep(0.02)
        yield c
    main.state.engine = None


def test_health_and_ready(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").json()["ready"] is True


def test_default_voice_listed(client):
    assert client.get("/voices").json()["voices"][0]["id"] == "default"


def test_synthesize_uses_requested_voice(client):
    r = client.post("/synthesize", json={"text": "Hello there.", "voice_id": "default"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    assert main.state.engine.last_voice == "default"


def test_unknown_voice_rejected(client):
    assert client.post("/synthesize", json={"text": "x", "voice_id": "nope"}).status_code == 404


def test_rejects_empty_and_oversized_text(client):
    assert client.post("/synthesize", json={"text": ""}).status_code == 422
    assert client.post("/synthesize", json={"text": "a" * 601}).status_code == 422


def test_delete_default_forbidden_and_bad_id(client):
    assert client.delete("/voices/default").status_code == 400
    assert client.delete("/voices/../../etc").status_code in (404, 422)
    assert client.delete("/voices/not-a-uuid").status_code == 422
