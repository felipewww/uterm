#!/usr/bin/env bash
# Switch the TTS service to an NVIDIA GPU (or back to CPU with --cpu). Rebuilds only the tts image; volumes
# (models, saved voices) are kept. Needs an NVIDIA driver and about 3 GiB of free VRAM. Never uses sudo.
set -euo pipefail
cd "$(dirname "$0")/.."
GEN=docker-compose.gpu.generated.yml   # machine-specific, git-ignored
# Compose reads COMPOSE_FILE from .env, so setup.sh / stop.sh / plain `docker compose` keep using the same flavour.
set_compose_file() { # $1 = value, empty removes the line
  touch .env
  (umask 077; grep -v '^COMPOSE_FILE=' .env > .env.tmp || true) # .env holds passwords: keep it private
  [[ -n "$1" ]] && echo "COMPOSE_FILE=$1" >> .env.tmp
  mv .env.tmp .env
}

if [[ "${1:-}" == "--cpu" ]]; then
  rm -f "$GEN"; set_compose_file ""
  docker compose up -d --build --force-recreate tts
  echo "TTS is back on CPU."; exit 0
fi

command -v nvidia-smi >/dev/null || { echo "nvidia-smi not found: no NVIDIA driver on this machine." >&2; exit 1; }
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

if docker info 2>/dev/null | grep -qi 'runtimes:.*nvidia'; then
  echo "Using the NVIDIA container runtime."
  cat > "$GEN" <<'YAML'
services:
  tts:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
YAML
else
  echo "No NVIDIA container runtime: mapping the GPU devices and driver libraries directly."
  {
    echo "services:"; echo "  tts:"
    echo "    devices:"
    for d in /dev/nvidia0 /dev/nvidiactl /dev/nvidia-uvm; do [[ -e $d ]] && echo "      - $d:$d"; done
    echo "    volumes:"
    for so in libcuda.so.1 libnvidia-ptxjitcompiler.so.1 libnvidia-nvvm.so.4 libnvidia-ml.so.1; do
      f=$(ldconfig -p | awk -v n="$so" '$1==n {print $NF; exit}')
      [[ -n "${f:-}" ]] && echo "      - $(readlink -f "$f"):/usr/lib/x86_64-linux-gnu/$so:ro"
    done
    # versioned-only driver library (no soname link on some distros)
    g=$(ls /usr/lib/x86_64-linux-gnu/libnvidia-gpucomp.so.* /usr/lib64/libnvidia-gpucomp.so.* 2>/dev/null | head -1 || true)
    [[ -n "${g:-}" ]] && echo "      - $g:/usr/lib/x86_64-linux-gnu/$(basename "$g"):ro"
    true
  } > "$GEN"
fi

set_compose_file "docker-compose.yml:docker-compose.gpu.yml:$GEN"
docker compose up -d --build tts
echo "TTS now runs on the GPU. Check: docker compose logs tts | tail   (revert with: scripts/tts-gpu.sh --cpu)"
