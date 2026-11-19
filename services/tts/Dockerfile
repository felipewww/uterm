FROM python:3.11.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl libsndfile1 ffmpeg git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
# torch first (Chatterbox pins torch==2.6.0 for Python 3.11). CPU wheels by default; the GPU override
# (docker-compose.gpu.yml, scripts/tts-gpu.sh) passes the CUDA 12.4 index instead.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install torch==2.6.0 torchaudio==2.6.0 --index-url ${TORCH_INDEX}
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
RUN useradd -m tts && mkdir -p /models /voices && chown -R tts /models /voices /srv
USER tts
EXPOSE 8090
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
