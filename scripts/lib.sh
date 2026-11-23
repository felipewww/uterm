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

compose() { docker compose --project-directory "$ROOT" "$@"; }

# Electron's chrome-sandbox needs root:4755 on Ubuntu. We never sudo for you: we only report it.
sandbox_flag() {
  local sb="$ROOT/desktop/node_modules/electron/dist/chrome-sandbox"
  if [ -f "$sb" ] && [ "$(stat -c '%U:%a' "$sb")" = "root:4755" ]; then echo ""; else echo "--no-sandbox"; fi
}
