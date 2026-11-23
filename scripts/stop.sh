#!/usr/bin/env bash
# Stop the optional Chatterbox Docker server. Its model and voice volumes are NOT deleted.
source "$(dirname "$0")/lib.sh"
have docker || { c_err "docker not found"; exit 1; }
compose stop
c_ok "Stopped. Volumes are preserved. (Remove them only with: docker compose down -v)"
