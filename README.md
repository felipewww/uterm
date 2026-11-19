# Echo-Term

A local-first desktop workspace for talking to coding agents. It keeps the **real interactive Claude Code and Codex CLIs**
in embedded terminals, and adds named/resumable sessions, voice input (whisper.cpp) and spoken updates (Chatterbox Turbo),
with no extra paid APIs and no extra LLM. Linux (Ubuntu) first; macOS later.

## Quick start (Ubuntu)
Prerequisites (installed by you; scripts never run sudo): Node.js ≥ 20, Docker + Compose plugin (your user in the `docker`
group), `build-essential` (for node-pty), Claude Code and/or Codex CLI already logged in, VS Code `code` on PATH (optional).

```bash
./scripts/setup.sh    # checks prerequisites, .env, npm install, builds images, downloads Whisper, starts services, migrations, hooks
./scripts/dev.sh      # starts Docker services, applies migrations, launches the Electron app (dev)
./scripts/doctor.sh   # diagnostics
./scripts/stop.sh     # stops containers, keeps volumes
```
The first TTS start downloads Chatterbox weights (several GB) — the app opens immediately and shows TTS as "warming up".
If Electron aborts with a SUID-sandbox error, either use `dev.sh` (falls back to `--no-sandbox` for dev) or run the printed `sudo chown/chmod` yourself.

Desktop scripts (`cd desktop`): `npm run dev | build | test | lint | typecheck | package`.
Benchmarks: `node scripts/benchmark-audio.mjs`. Real-CLI smoke test: see `desktop/tests/smoke/agent-smoke.cjs`.

## Using it
- **＋** creates a session (agent, title, folder picker) or imports an existing Claude/Codex conversation. Double-click a title to rename.
- Closing a session ends only its process; **Resume** later runs `claude --resume <id>` / `codex resume <id>` in the stored folder.
- Mic button or `Ctrl+Shift+Space` records → local transcription → edit → **Send** (to the session that was selected when you started recording).
- Voice modes per session, foreground and background independently: **Silent**, **Essential** (questions/permissions/blockers),
  **Balanced** (+ final results), **Conversational** (+ progress). Defaults: foreground Balanced, background Silent.
- Toolbar: mute, stop audio (never stops the agent), replay, open in VS Code, global mute, per-session voice settings.
- Claude permission prompts and questions are never answered for you; typed/spoken text is held back while one is showing.

## Docs
`docs/architecture.md`, `docs/technical-validation.md` (measurements, findings, **what was not tested**), `docs/implementation-plan.md`.

## Privacy
No telemetry. Ports bind to 127.0.0.1; the hook socket is `0600` in `$XDG_RUNTIME_DIR`; recordings stay in memory; containers
don't mount your home or agent credentials; DB credentials are stored only in `.env` / `~/.config/echo-term/.env` (mode 600).
