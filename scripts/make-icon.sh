#!/usr/bin/env bash
# Regenerates the app icons from desktop/build/icon.svg (needs rsvg-convert, from librsvg).
#  - build/icon.png         512 px, used by electron-builder for the packaged app
#  - build/icon-window.png  192 px, used for the BrowserWindow: Electron/Chromium on X11 silently drops window icons of 256 px or more
set -euo pipefail
cd "$(dirname "$0")/../desktop/build"
command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found (install librsvg2-bin)"; exit 1; }
rsvg-convert -w 512 -h 512 icon.svg -o icon.png
rsvg-convert -w 192 -h 192 icon.svg -o icon-window.png
echo "icons regenerated"
