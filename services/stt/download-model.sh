#!/bin/bash
# Idempotent: skips the download if the model already exists in the volume.
set -euo pipefail
f="/models/${STT_MODEL_FILE:-ggml-small.en.bin}"
if [ -s "$f" ]; then echo "model present: $f"; exit 0; fi
mkdir -p /models
curl -fL --retry 3 -o "$f.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${STT_MODEL_FILE:-ggml-small.en.bin}"
mv "$f.part" "$f"
echo "downloaded: $f"
