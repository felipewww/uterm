#!/usr/bin/env bash
# Regenerates the app icons from desktop/build/icon-source.png (see make-icon.cjs).
set -euo pipefail
cd "$(dirname "$0")/../desktop"
ELECTRON_RUN_AS_NODE= npx electron --no-sandbox ../scripts/make-icon.cjs
