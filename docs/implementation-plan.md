# Implementation plan and status

| Milestone | Status | Notes |
|---|---|---|
| 0 Technical validation | Done (see technical-validation.md) | TTS speed target missed; documented, model kept |
| 1 Infra + terminal workspace | Done | Compose (MySQL/STT/TTS), migrations, Electron, xterm/node-pty, multi-session, titles, persistence, resume, import |
| 2 Structured events | Done (Claude), partial (Codex) | Event bus, hooks, reorder, activity panel, attention; Codex permissions/questions limited |
| 3 Voice input | Implemented, mic path untested | Recorder, shortcut, STT, editable preview, safe submit |
| 4 Voice output | Done | Chatterbox, profiles, per-session voice, 4 modes × fg/bg, global queue, listen-again from Activity, stop |
| 5 Stabilization | Mostly done | 86 tests, scripts, docs, Linux `dir` package; AppImage/deb not built |

## Known limitations / next steps
1. TTS on CPU runs at RTF ≈ 2.2–2.5 (first audio ≈ 4.5 s+). Evaluate Chatterbox Nano / GPU profile before changing models.
2. Verify the microphone path and recording shortcut by hand; consider a global shortcut.
3. Exercise Claude permission/question/failure hooks live and Codex hooks after `/hooks` trust.
4. Build and test AppImage/deb; configure `chrome-sandbox` in the deb post-install.
5. Voice-profile preview text and per-voice speed are basic.
