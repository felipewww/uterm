#!/usr/bin/env bash
# Downloads the built-in speech-to-text model (Whisper base, quantised, ~76 MB) into desktop/build/models so the macOS build can ship it
# and work offline. Without it the app downloads the model once on first use.
set -euo pipefail
cd "$(dirname "$0")/../desktop"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/fetch.mjs" <<'JS'
import { pipeline, env } from '@huggingface/transformers'
env.cacheDir = process.argv[2]
await pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { dtype: 'q8' })
console.log('model ready')
JS
cp "$tmp/fetch.mjs" ./.fetch-model.mjs
ELECTRON_RUN_AS_NODE=1 npx electron ./.fetch-model.mjs "$PWD/build/models" ; rm -f ./.fetch-model.mjs
