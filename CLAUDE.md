# uTerm — notes for coding agents

Monorepo of **independent** projects (no npm workspaces): `desktop/` (Electron + Vue 3 + TS strict), `services/tts`
(optional Chatterbox server, FastAPI), `hooks/`, `scripts/`, `docs/`. The app needs no Docker: one SQLite file, Whisper inside the app, system voice by default;
dev and the installed app behave the same (no `.env`, API keys live in the encrypted store, see `desktop/src/main/secrets.ts`).

## Commands
- Desktop: `cd desktop && npm run typecheck && npm run lint && npm run test` (vitest). Build: `npm run build`. Dev app: `./scripts/dev.sh`.
- TTS tests (mocked engine): `docker run --rm -v "$PWD/services/tts":/w -w /w python:3.11.11-slim-bookworm sh -c 'pip install -q fastapi==0.115.6 python-multipart==0.0.20 pytest==8.3.4 httpx==0.28.1 && python -m pytest -q'`
- Real-model checks are separate: `node scripts/benchmark-audio.mjs`, `desktop/tests/smoke/agent-smoke.cjs` (run with `ELECTRON_RUN_AS_NODE=1 npx electron …` because node-pty is built for Electron's ABI).

## Rules that matter
- Never replace the real CLI with a chat UI, never scrape the terminal for semantics, never auto-approve permissions.
- Hooks must exit 0, print nothing, stay fast, and ignore processes without `ECHO_TERM_SESSION_ID`.
- Async hook events are **unordered**; keep the reorder buffer and turn tracker. Re-record fixtures with the smoke script if payloads change.
- VoicePolicy/speech text are deterministic (no LLM). Add agents by implementing `AgentAdapter`; don't touch PtyManager/AudioQueue/VoicePolicy.
- Runtime state is never persisted. Voice/IPC inputs are zod-validated; no shell strings from event payloads.
- Don't report tests as passing unless run; keep `docs/technical-validation.md` honest about untested areas.
- Don't `pkill -f` a pattern that appears in your own command line (it kills your shell); use the `[x]` bracket trick.
