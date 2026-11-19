# Architecture

```
Electron Renderer (Vue 3 + xterm.js)  ── IPC (contextIsolation, restricted preload, zod-validated) ──  Electron Main
   sessions · terminals · activity · voice bar · audio playback                    │
                                                                                    ├─ PtyManager ── node-pty ── claude / codex / kiro-cli (native, on the host)
                                                                                    ├─ AgentAdapters (Claude, Codex) → AgentObserver
                                                                                    ├─ HookServer (Unix socket, 0600) ← hooks/*/hook.mjs  ┐ structured
                                                                                    ├─ Codex rollout tailer (read-only)                    ┘ channel
                                                                                    ├─ EventBus → SessionManager (runtime state), Activity, VoicePolicy, persistence
                                                                                    ├─ AudioQueue (global, priority) → TtsClient ─┐
                                                                                    ├─ SttClient ────────────────────────────────┤  Docker Compose (localhost only)
                                                                                    └─ MySQL (mysql2, app user)                  └─ MySQL 8.4 · whisper.cpp · Chatterbox Turbo
```
The PTY channel (bytes in/out of the real CLI) and the structured channel (hooks/transcripts → events) never mix: no
screen scraping is used for semantics.

## Layout
`desktop/src/main` (backend), `src/preload` (bridge), `src/renderer` (Vue), `src/shared` (types, IPC schemas).
`services/tts` is a small FastAPI app; `services/stt` is the official whisper.cpp image + a model downloader.
`hooks/` holds the forwarder (`claude/hook.mjs`, shared by Codex), JSON templates and the installer.

## Key decisions
- **UI framework:** the brief's stack says Vue 3 while its diagram says "React UI"; Vue 3 was used.
- **Claude hooks via `--settings`** (not `~/.claude/settings.json`): zero interference with user config, hooks apply only to
  Echo-Term-launched processes, and unmanaged sessions can't leak events (no `ECHO_TERM_SESSION_ID` ⇒ the script exits).
- **Correlation:** the PTY gets `ECHO_TERM_SESSION_ID` (internal UUID) in its environment; hook envelopes carry it, so two
  sessions in the same directory never mix. Claude's native id is pre-assigned with `--session-id`; Codex's is read from the rollout.
- **Reorder buffer + turn tracker** (see technical-validation.md) because async hooks are unordered.
- **Voice policy is a pure function**: `SPEECH_MATRIX[mode][kind]`, foreground = selected session **and** focused window.
  The queue re-evaluates policy before synthesis, between chunks, and whenever selection/focus/settings change.
  Background items are prefixed with the session title. Questions/permissions/blockers (1) > finals (2) > progress (3);
  higher priority interrupts; a cut-off final is replayed once; progress expires and is dropped at turn end; dedupe by message id.
- **Speech text is deterministic:** `<voice>…</voice>` wins; otherwise fenced code, diffs, shell lines, stack frames, tables, bare
  paths and URLs are removed and the prose is cut at a sentence boundary (default 400 chars). Permission requests are
  spoken generically ("I need your permission to run a command") — raw commands are never read.
- **Transcript safety:** text goes in via bracketed paste with ESC stripped; never into `WAITING_FOR_PERMISSION`/`WAITING_FOR_INPUT`
  (unless the user presses Send a second time); auto-submit only from `IDLE`; each draft is bound to the session selected
  when recording started. Nothing ever answers a permission prompt.
- **Persistence:** runtime state (`STARTING…CLOSED`) is memory-only, so a restart can't show dead processes as running. If MySQL is
  down the app falls back to an in-memory repository, shows a warning, and terminals keep working. Complete conversations are not stored.
- **Recording shortcut** is an in-app (focused-window) shortcut; a global OS-level shortcut is a later option.
- **Audio is optional:** STT/TTS failures surface as toasts/status-bar state and never touch terminals.

## Capability differences
| | Claude Code | Codex CLI |
|---|---|---|
| Native id | pre-assigned (`--session-id`) | read from rollout `session_meta` |
| Progress messages | `MessageDisplay` hook | rollout `phase: commentary` |
| Final result | `Stop.last_assistant_message` | `task_complete.last_agent_message` |
| Permission requests | `PermissionRequest` hook | hook only, needs one-time `/hooks` trust |
| Interactive questions | `AskUserQuestion` via `PreToolUse` | not exposed → visual only |
| Speech instructions | `--append-system-prompt` (optional setting) | `-c developer_instructions=…` per process (skipped if you set your own in config.toml); Kiro: sent as the first message of a new session |
