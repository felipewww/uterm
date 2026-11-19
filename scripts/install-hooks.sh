#!/usr/bin/env bash
# Explicit, idempotent hook management.  Usage: ./scripts/install-hooks.sh install|uninstall|status
source "$(dirname "$0")/lib.sh"
have node || { c_err "node not found"; exit 1; }
exec node "$ROOT/hooks/install.mjs" "${1:-status}"
