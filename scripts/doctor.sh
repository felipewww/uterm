#!/usr/bin/env bash
# Read-only diagnostics. Exit code = number of failed checks.
source "$(dirname "$0")/lib.sh"
fail=0
ok()   { c_ok "$*"; }
bad()  { c_err "$*"; fail=$((fail+1)); }
warn() { c_warn "$*"; }

[ -f .env ] && ok ".env present" || { bad ".env missing (run ./scripts/setup.sh)"; exit 1; }
set -a; . ./.env; set +a

echo "— Docker"
if have docker && docker info >/dev/null 2>&1; then ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ,)"; else bad "Docker unavailable"; fi
docker compose version >/dev/null 2>&1 && ok "Compose $(docker compose version --short)" || bad "Docker Compose plugin missing"
for s in mysql stt tts; do
  if [ "$s" != mysql ] && ! service_on "$s"; then ok "$s: turned off in the app (memory freed)"; continue; fi
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(compose ps -q $s 2>/dev/null)" 2>/dev/null || echo "not created")"
  [ "$st" = "healthy" ] && ok "$s container: healthy" || bad "$s container: $st (docker compose logs $s)"
done

echo "— Database"
if node scripts/migrate.mjs >/tmp/echo-doctor-migrate.log 2>&1; then ok "MySQL reachable as app user; migrations: $(tail -1 /tmp/echo-doctor-migrate.log)"; else bad "MySQL/migrations failed: $(tail -1 /tmp/echo-doctor-migrate.log | sed 's/password=[^ ]*/password=***/')"; fi

echo "— Speech services"
if curl -fsS -m 3 "http://127.0.0.1:${STT_PORT:-18080}/health" >/dev/null 2>&1; then ok "STT health"; else bad "STT not reachable on :${STT_PORT:-18080}"; fi
if docker run --rm -v echo-term_stt-models:/m:ro --entrypoint sh ghcr.io/ggml-org/whisper.cpp:main -c "test -s /m/${STT_MODEL_FILE:-ggml-small.en.bin}" >/dev/null 2>&1; then ok "Whisper model file present (${STT_MODEL_FILE:-ggml-small.en.bin})"; else bad "Whisper model missing: ./scripts/setup.sh"; fi
r="$(curl -sS -m 3 "http://127.0.0.1:${TTS_PORT:-18090}/ready" 2>/dev/null || true)"
case "$r" in *'"ready":true'*) ok "TTS ready (Chatterbox Turbo loaded: $r)";; '') bad "TTS not reachable on :${TTS_PORT:-18090}";; *) warn "TTS up but model not ready yet: $r";; esac

echo "— Agents and native dependencies"
have claude && ok "Claude Code $(claude --version 2>&1 | head -1)" || warn "Claude Code not on PATH"
have codex  && ok "Codex $(codex --version 2>&1 | head -1)" || warn "Codex CLI not on PATH"
have kiro-cli && ok "Kiro CLI $(kiro-cli --version 2>&1 | head -1)" || warn "Kiro CLI not on PATH (optional)"
have code   && ok "VS Code 'code' command found" || warn "'code' not on PATH (Open in VS Code will not work)"
if [ -d desktop/node_modules/node-pty ]; then
  if ls desktop/node_modules/node-pty/build/Release/pty.node >/dev/null 2>&1 || ls desktop/node_modules/node-pty/prebuilds/*/pty.node >/dev/null 2>&1; then ok "node-pty native module built"; else bad "node-pty not built: cd desktop && npm run rebuild"; fi
else bad "desktop dependencies not installed"; fi
sb="$(sandbox_flag)"; [ -z "$sb" ] && ok "Electron SUID sandbox configured" || warn "Electron SUID sandbox not configured (dev uses --no-sandbox)"

echo "— Hooks"
if node hooks/install.mjs status; then ok "hooks installed"; else warn "hooks not fully installed: ./scripts/install-hooks.sh install"; fi
[ -S "${XDG_RUNTIME_DIR:-/tmp/echo-term-$(id -u)}/echo-term/hooks.sock" ] && ok "hook socket is listening (app running)" || warn "hook socket absent (app not running)"

echo "— Audio devices (best effort)"
if have arecord && arecord -l 2>/dev/null | grep -q 'card'; then ok "capture device present"; else warn "no capture device detected by arecord (the app can still use PipeWire/Pulse mics)"; fi
if have pw-play || have paplay || have aplay; then ok "playback tools present"; else warn "no playback tool found"; fi

echo
[ "$fail" -eq 0 ] && c_ok "All required checks passed" || c_err "$fail check(s) failed"
exit "$fail"
