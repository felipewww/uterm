"""Managed voice reference storage. Never accepts host paths."""
from __future__ import annotations

import json
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NAME_RE = re.compile(r"^[\w .'-]{1,80}$")
MAX_UPLOAD_BYTES = 30 * 1024 * 1024


@dataclass
class Voice:
    id: str
    name: str


class VoiceStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _dir(self, voice_id: str) -> Path:
        if not ID_RE.match(voice_id):
            raise ValueError("invalid voice id")
        return self.root / voice_id

    def ref_path(self, voice_id: str) -> Path:
        return self._dir(voice_id) / "ref.wav"

    def list(self) -> list[Voice]:
        out: list[Voice] = []
        for d in sorted(self.root.iterdir()):
            meta = d / "meta.json"
            if d.is_dir() and ID_RE.match(d.name) and meta.exists():
                out.append(Voice(d.name, json.loads(meta.read_text())["name"]))
        return out

    def create(self, name: str, wav_bytes: bytes) -> Voice:
        if not NAME_RE.match(name):
            raise ValueError("invalid voice name")
        vid = str(uuid.uuid4())
        d = self._dir(vid)
        d.mkdir(parents=True)
        (d / "ref.wav").write_bytes(wav_bytes)
        (d / "meta.json").write_text(json.dumps({"name": name}))
        return Voice(vid, name)

    def delete(self, voice_id: str) -> bool:
        d = self._dir(voice_id)
        if not d.exists():
            return False
        shutil.rmtree(d)
        return True
