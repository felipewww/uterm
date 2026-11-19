# Official whisper.cpp image (CPU), pinned by digest. It ships whisper-server,
# so no custom wrapper is needed.
FROM ghcr.io/ggml-org/whisper.cpp:main@sha256:1dd7c65b1b7bf7b19f0b943e4c320eabbbdf5c7546dc34ba77432422fc04ced0
COPY download-model.sh /opt/download-model.sh
RUN chmod +x /opt/download-model.sh
EXPOSE 8080
ENTRYPOINT ["/bin/bash", "-c", "exec /app/build/bin/whisper-server --host 0.0.0.0 --port 8080 -m /models/${STT_MODEL_FILE} -t ${STT_THREADS:-4} -l en --prompt 'Software engineering discussion: TypeScript, Vue, Docker, MySQL, npm, API, refactor, pull request.' --carry-initial-prompt"]
