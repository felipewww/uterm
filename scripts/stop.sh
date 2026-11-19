#!/usr/bin/env bash
# Stop the Docker services. Volumes (database, models, voices) are NOT deleted.
source "$(dirname "$0")/lib.sh"
compose stop
c_ok "Services stopped. Data volumes are preserved. (Remove them only with: docker compose down -v)"
