#!/usr/bin/env bash
# One-time (and idempotent) setup. Never installs system packages; tells you what is missing.
source "$(dirname "$0")/lib.sh"

c_info "Checking prerequisites (Ubuntu)"
missing=0
req() { if have "$1"; then c_ok "$1: $($1 --version 2>&1 | head -1)"; else c_err "$1 not found. $2"; missing=1; fi; }
req node  "Install Node.js 22 LTS (e.g. via nvm or NodeSource)."
req npm   "Comes with Node.js."
req g++   "Needed to build node-pty: sudo apt install build-essential python3 make g++"
req make  "sudo apt install build-essential"
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge 22 ] || { c_err "Node.js >= 22 required (found $node_major)"; missing=1; }
[ "$missing" -eq 0 ] || { c_err "Fix the items above and re-run ./scripts/setup.sh"; exit 1; }
have espeak-ng && c_ok "espeak-ng (system voice)" || c_warn "No system voice: install it with  sudo apt install espeak-ng  (or choose a cloud voice in Settings → Voice)"

c_info "Desktop dependencies"
( cd desktop && npm install --no-audit --no-fund ) && c_ok "npm install done (node-pty rebuilt for Electron)"

c_info "Agent hooks (Claude via --settings; Codex hooks.json merge)"
./scripts/install-hooks.sh install || c_warn "hook installation reported a problem"

c_info "Coding agents"
have claude && c_ok "claude: $(claude --version 2>&1 | head -1)" || c_warn "Claude Code not found on PATH"
have codex  && c_ok "codex: $(codex --version 2>&1 | head -1)"  || c_warn "Codex CLI not found on PATH"

sb="$(sandbox_flag)"
if [ -n "$sb" ]; then
  c_warn "Electron's SUID sandbox is not configured. ./scripts/dev.sh will use --no-sandbox (development only)."
  echo "   To enable it (manual, needs sudo):"
  echo "   sudo chown root:root desktop/node_modules/electron/dist/chrome-sandbox && sudo chmod 4755 desktop/node_modules/electron/dist/chrome-sandbox"
fi
c_ok "Setup finished. Run ./scripts/dev.sh"
echo "   Optional: a Chatterbox voice server with  docker compose up -d tts  (then Settings → Voice)."
