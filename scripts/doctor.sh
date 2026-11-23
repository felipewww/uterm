#!/usr/bin/env bash
# Read-only diagnostics. Exit code = number of failed checks.
source "$(dirname "$0")/lib.sh"
fail=0
ok()   { c_ok "$*"; }
bad()  { c_err "$*"; fail=$((fail+1)); }
warn() { c_warn "$*"; }

echo "— Speech"
have espeak-ng || [ "$(uname -s)" = "Darwin" ] && ok "system voice available" || warn "no system voice: sudo apt install espeak-ng (or use a cloud voice)"
if [ -d desktop/node_modules/@huggingface/transformers ]; then ok "built-in speech recognition installed (Whisper; the model downloads on first use)"; else bad "desktop dependencies not installed"; fi
r="$(curl -sS -m 2 "http://127.0.0.1:${TTS_PORT:-18090}/ready" 2>/dev/null || true)"
case "$r" in *'"ready":true'*) ok "optional Chatterbox server: ready";; '') ok "optional Chatterbox server: not running (fine unless you chose it in Settings)";; *) warn "Chatterbox server up but the model is not ready yet: $r";; esac

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
