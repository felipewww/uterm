#!/usr/bin/env bash
# Start infrastructure (if needed) and launch the native Electron app in development mode.
source "$(dirname "$0")/lib.sh"
load_env
have docker || { c_err "docker not found"; exit 1; }

c_info "Starting Docker services (MySQL, STT, TTS)"
compose up -d mysql stt tts
wait_healthy mysql 120 || { c_err "MySQL is not healthy. Run ./scripts/doctor.sh"; exit 1; }
c_ok "MySQL ready"
node scripts/migrate.mjs
c_info "STT/TTS may still be warming up; the app shows them as unavailable until ready and never blocks the terminals."

cd desktop
[ -d node_modules ] || { c_info "Installing desktop dependencies"; npm install --no-audit --no-fund; }
flag="$(sandbox_flag)"
[ -z "$flag" ] || c_warn "Electron SUID sandbox not configured → running with --no-sandbox (dev only; see ./scripts/setup.sh)"
export ECHO_TERM_ROOT="$ROOT"
# electron-vite forwards arguments after -- to Electron
exec npx electron-vite dev -- $flag
