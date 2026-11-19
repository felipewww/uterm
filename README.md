# Echo-Term

A local-first desktop workspace for talking to coding agents. It keeps the **real interactive Claude Code, Codex and Kiro CLIs**
in embedded terminals, and adds named/resumable sessions, voice input (whisper.cpp) and spoken updates (Chatterbox Turbo),
with no extra paid APIs and no extra LLM. Linux (Ubuntu) first; macOS later.

## Quick start (Ubuntu)
Prerequisites (installed by you; scripts never run sudo): Node.js ≥ 20, Docker + Compose plugin (your user in the `docker`
group), `build-essential` (for node-pty), at least one of Claude Code, Codex CLI or Kiro CLI already logged in (the app detects which ones are installed, including in `~/.local/bin` and Homebrew folders), VS Code `code` on PATH (optional).

```bash
./scripts/setup.sh    # checks prerequisites, .env, npm install, builds images, downloads Whisper, starts services, migrations, hooks
./scripts/dev.sh      # starts Docker services, applies migrations, launches the Electron app (dev)
./scripts/doctor.sh   # diagnostics
./scripts/stop.sh     # stops containers, keeps volumes
```
The first TTS start downloads Chatterbox weights (several GB) — the app opens immediately and shows TTS as "warming up".

**Faster voice on an NVIDIA GPU (optional).** On CPU the voice generates at roughly 2x slower than real time. With a GPU of about 4 GB or more,
`./scripts/tts-gpu.sh` rebuilds only the `tts` image with CUDA and restarts it (it works with or without nvidia-container-toolkit and never uses sudo);
`./scripts/tts-gpu.sh --cpu` goes back. Measured on a GTX 1650 (4 GB): ~0.45x real time, about 3 GiB of VRAM.
**A livelier voice:** Chatterbox copies the delivery of its reference clip, so a short, warm and animated recording (Settings → Voice → new voice) sounds
much more expressive than the neutral default voice.
If Electron aborts with a SUID-sandbox error, either use `dev.sh` (falls back to `--no-sandbox` for dev) or run the printed `sudo chown/chmod` yourself.

Desktop scripts (`cd desktop`): `npm run dev | build | test | lint | typecheck | package`.
Benchmarks: `node scripts/benchmark-audio.mjs`. Real-CLI smoke test: see `desktop/tests/smoke/agent-smoke.cjs`.

## Using it
- **＋** creates a session (agent, title, folder picker) or imports an existing Claude/Codex/Kiro conversation. Double-click a title to rename.
- Closing a session ends only its process; **Resume** later runs `claude --resume <id>` / `codex resume <id>` / `kiro-cli chat --resume-id <id>` in the stored folder.
- Mic button or `Ctrl+Shift+Space` records → local transcription → edit → **Send** (to the session that was selected when you started recording).
- Voice modes per session, foreground and background independently: **Silent**, **Essential** (questions/permissions/blockers),
  **Balanced** (+ final results), **Conversational** (+ progress). Defaults: foreground Balanced, background Silent.
- Terminal card header: mute this session, per-session voice settings, open in VS Code, show/hide Activity; a stop button appears while audio is playing (it never stops the agent).
- Activity: every agent message has a listen button to hear it again (replayed from a small in-memory audio cache when possible); messages the app already spoke are marked. Mute-all is in the sidebar footer.
- Folders: create them from the sidebar (folder button), nest them (right-click a folder → New subfolder / Move folder to), and drag sessions or folders in or out (drop on Active/Closed or the bottom strip for top level), or use the session menu "Move to folder". Deleting a folder moves its contents up one level. Stored in MySQL (migrations `0003`, `0004`).
- Voice services on/off: the STT and TTS chips at the bottom of the sessions list (or Settings → Services) stop and start their Docker containers, freeing their memory (≈0.7 GB and ≈4–6 GB). The choice is saved in `.services.local` (git-ignored), so `./scripts/dev.sh` and `./scripts/doctor.sh` respect it. With TTS off nothing is synthesised and no errors appear; with STT off the voice composer says so.
- Voices: one picker lists every voice, **local** ones (the built-in voice and clones) and **cloud** ones (30 Gemini voices with their character, 13 OpenAI voices). The provider is part of the voice, so there is a **default voice** (Settings → Voice) and each chat can pick its own (speaker button in its header), mixing local and cloud freely. Cloud voices are opt-in: put `ECHO_TERM_GEMINI_API_KEY` / `ECHO_TERM_OPENAI_API_KEY` in `.env` (never in the database, never passed to the agents). Settings → Cloud voice has a **Test** button per provider (lists models, speaks one sentence, transcribes it back; a fraction of a cent), editable model names with "Refresh model lists", the transcription provider (local / OpenAI / Gemini, global) and the delivery style. Settings → Usage keeps an **estimated** running total of cloud spend (today / month / all time) from the usage each call reports and public list prices; the provider dashboards hold the real bill. If every chat uses cloud voices you can turn the local TTS service off to free its memory. Text of spoken replies (or recorded audio) leaves the machine only for chats/transcription that use a cloud provider.
- English coach: after each voice recording, the composer shows your transcription (editable) and, below it, a **more natural version** (CEFR B2–C1, same meaning, no forced vocabulary) written by a small OpenAI text model (default `gpt-4o-mini`, editable). "Use this version" swaps it into the box, "Back to mine" restores yours, "Redo" regenerates from the current text. It only affects what you see: nothing is sent or spoken differently. On/off globally (Settings → Voice) and per chat (the chat's voice settings, or "Off for this chat" in the panel); it needs `ECHO_TERM_OPENAI_API_KEY`, and its cost (a fraction of a cent per phrase) appears in Settings → Usage. Typed text in the terminal is not covered: the terminal is never intercepted.
- Settings: General (theme, terminal background, default agent), Voice, Microphone, Services.
- Claude permission prompts and questions are never answered for you; typed/spoken text is held back while one is showing.

## Docs
`docs/architecture.md`, `docs/technical-validation.md` (measurements, findings, **what was not tested**), `docs/implementation-plan.md`.

## Privacy
No telemetry. Ports bind to 127.0.0.1; the hook socket is `0600` in `$XDG_RUNTIME_DIR`; recordings stay in memory; containers
don't mount your home or agent credentials; DB credentials are stored only in `.env` / `~/.config/echo-term/.env` (mode 600).
