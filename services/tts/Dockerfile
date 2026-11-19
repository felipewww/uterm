FROM python:3.11.11-slim-bookworm

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl libsndfile1 ffmpeg git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
# CPU-only torch first (Chatterbox pins torch==2.6.0 for Python 3.11).
RUN pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
RUN useradd -m tts && mkdir -p /models /voices && chown -R tts /models /voices /srv
USER tts
EXPOSE 8090
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
