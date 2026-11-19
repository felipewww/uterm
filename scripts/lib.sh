#!/usr/bin/env bash
# Shared helpers for the uTerm scripts. Never installs system packages and never calls sudo.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

c_ok()   { printf '\033[32m✔\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
c_err()  { printf '\033[31m✘\033[0m %s\n' "$*" >&2; }
c_info() { printf '\033[36m→\033[0m %s\n' "$*"; }
have()   { command -v "$1" >/dev/null 2>&1; }

load_env() {
  [ -f "$ROOT/.env" ] || { c_err ".env missing. Run ./scripts/setup.sh first."; exit 1; }
  set -a; . "$ROOT/.env"; set +a
}

# The app's on/off choice for the voice services (Settings → Services, or the STT/TTS chips). Default: on.
service_on() { local f="$ROOT/.services.local"; [ -f "$f" ] && grep -qx "$1=off" "$f" && return 1; return 0; }

compose() { docker compose --project-directory "$ROOT" "$@"; }

wait_healthy() { # service, timeout seconds
  local svc="$1" t="${2:-120}" i=0 cid st
  while [ "$i" -lt "$t" ]; do
    cid="$(compose ps -q "$svc" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      [ "$st" = "healthy" ] && return 0
    fi
    sleep 2; i=$((i+2))
  done
  return 1
}

# Electron's chrome-sandbox needs root:4755 on Ubuntu. We never sudo for you: we only report it.
sandbox_flag() {
  local sb="$ROOT/desktop/node_modules/electron/dist/chrome-sandbox"
  if [ -f "$sb" ] && [ "$(stat -c '%U:%a' "$sb")" = "root:4755" ]; then echo ""; else echo "--no-sandbox"; fi
}
