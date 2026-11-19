#!/usr/bin/env bash
# One-time (and idempotent) setup. Never installs system packages; tells you what is missing.
source "$(dirname "$0")/lib.sh"

c_info "Checking prerequisites (Ubuntu)"
missing=0
req() { if have "$1"; then c_ok "$1: $($1 --version 2>&1 | head -1)"; else c_err "$1 not found. $2"; missing=1; fi; }
req node  "Install Node.js 22 LTS (e.g. via nvm or NodeSource)."
req npm   "Comes with Node.js."
req docker "Install Docker Engine: https://docs.docker.com/engine/install/ubuntu/"
req g++   "Needed to build node-pty: sudo apt install build-essential python3 make g++"
req make  "sudo apt install build-essential"
if have docker; then
  docker compose version >/dev/null 2>&1 && c_ok "docker compose: $(docker compose version --short)" || { c_err "docker compose plugin missing: sudo apt install docker-compose-plugin"; missing=1; }
  docker info >/dev/null 2>&1 || { c_err "Cannot talk to Docker. Is the daemon running and is your user in the 'docker' group?"; missing=1; }
fi
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge 20 ] || { c_err "Node.js >= 20 required (found $node_major)"; missing=1; }
[ "$missing" -eq 0 ] || { c_err "Fix the items above and re-run ./scripts/setup.sh"; exit 1; }

c_info "Environment file"
if [ ! -f .env ]; then
  gen() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }
  pw="$(gen)"; rpw="$(gen)"
  sed -e "s/^MYSQL_PASSWORD=.*/MYSQL_PASSWORD=$pw/" -e "s/^ECHO_TERM_DB_PASSWORD=.*/ECHO_TERM_DB_PASSWORD=$pw/" \
      -e "s/^MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=$rpw/" .env.example > .env
  chmod 600 .env
  c_ok "created .env with generated local-only passwords"
else c_ok ".env already exists (kept)"; fi

c_info "App connection settings for packaged builds (~/.config/echo-term/.env, owner-only)"
mkdir -p "$HOME/.config/echo-term" && chmod 700 "$HOME/.config/echo-term"
grep -E '^ECHO_TERM_DB_' .env > "$HOME/.config/echo-term/.env" && chmod 600 "$HOME/.config/echo-term/.env"
c_ok "wrote database connection settings (no root credentials)"

c_info "Desktop dependencies"
( cd desktop && npm install --no-audit --no-fund ) && c_ok "npm install done (node-pty rebuilt for Electron)"

c_info "Docker images (MySQL, whisper.cpp, Chatterbox) — the TTS image is large; first build takes a while"
load_env
compose build stt tts
c_ok "images built"

c_info "Starting MySQL"
compose up -d mysql
wait_healthy mysql 120 && c_ok "MySQL healthy" || { c_err "MySQL did not become healthy: ./scripts/doctor.sh"; exit 1; }

c_info "Downloading the Whisper small.en model into its volume (skipped if present)"
compose --profile setup run --rm stt-models

c_info "Starting STT and TTS (Chatterbox downloads its weights on first start; this can take minutes)"
compose up -d stt tts
wait_healthy stt 120 && c_ok "STT healthy" || c_warn "STT not healthy yet: see 'docker compose logs stt'"

c_info "Applying database migrations"
( cd desktop && npx --no-install electron-vite build >/dev/null 2>&1 || true )
node scripts/migrate.mjs && c_ok "migrations applied"

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
