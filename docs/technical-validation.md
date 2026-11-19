# Technical validation (Milestone 0)

Everything below was **executed on this machine** (Ubuntu 25.10, Ryzen 7 / 16 threads, 32 GB, no dedicated GPU,
Docker 29.4, Node 22.23) unless it is explicitly listed under *Not tested*. Versions: Claude Code 2.1.328,
Codex CLI 0.169.0, Electron 45.4, node-pty 1.1.0, xterm.js 6.0, whisper.cpp (official image, `small.en`),
Chatterbox 0.1.7 (`ChatterboxTurboTTS`, PyTorch 2.6.0 CPU, Python 3.11).

## 1. Real CLIs in node-pty + xterm.js — PASS
- Claude Code and Codex both run inside node-pty (`tests/smoke/agent-smoke.cjs`) and Claude renders correctly in
  xterm.js inside the Electron app (colors, box drawing, bracketed paste, resize, footer, scrollback).
- Gotcha: Claude shows a folder-trust dialog on first use of a directory; Echo-Term never answers it for you.
- Gotcha (Ubuntu): Electron's SUID sandbox helper must be `root:4755`, otherwise Electron aborts. `dev.sh` falls back to
  `--no-sandbox` for development only and prints the manual `sudo` command; we never run sudo for you.

## 2–3. Claude hooks and MessageDisplay — PASS (with one important finding)
Hooks are injected per process with `claude --settings <file>`, so `~/.claude/settings.json` is untouched. Observed live:
`SessionStart, UserPromptSubmit, PreToolUse, MessageDisplay, PostToolUse, Stop, SessionEnd` all arrive with
`session_id`, `transcript_path`, `cwd`. `MessageDisplay` carries `message_id, index, final, delta`; in the captured turns
each short message arrived as one batch (`index 0, final true`). Multi-batch streaming was **not** observed live (short
messages); aggregation of multiple/out-of-order/duplicate/empty-final batches is covered by unit tests.

**Finding — async hooks arrive out of order.** Even by hook-process start time, `PreToolUse` started ~17 ms *before* the
`MessageDisplay` of the sentence preceding it, and `Stop` can be received before the last `MessageDisplay`. Design
consequences (all implemented and tested against the recorded fixture `tests/fixtures/claude-turn.json`, replayed in several
shuffled arrival orders):
1. Hook scripts stamp a monotonic start time; main re-sorts events in a 200 ms window (`ReorderBuffer`).
2. Classification can't rely on "tool use follows message". A completed message is a *candidate*: it becomes **progress** on
   the next message, on tool activity, or after a 1 s grace period; it becomes **final** when `Stop.last_assistant_message`
   matches. The same text is never spoken twice.
3. `--session-id <uuid>` pre-assigns the native session id for new sessions (confirmed equal to hook `session_id`).

## 4. Codex intermediate assistant messages — PASS via transcript tailing
Codex 0.169 writes `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`. Assistant messages are
`response_item` / `message` / `role=assistant` with `phase: "commentary"` (progress) or `"final_answer"`; `task_complete`
carries `last_agent_message`; prompts are `item_completed` / `UserMessage`. Echo-Term tails the file read-only (polling,
byte offset) and never replaces the interactive CLI. The native session id comes from `session_meta`; for new sessions the
rollout is discovered by creation time + `cwd`. Captured and scrubbed as `tests/fixtures/codex-turn.jsonl`.
Codex hooks exist (`~/.codex/hooks.json`) but **require a one-time trust review via `/hooks`**; Echo-Term installs only
`SessionStart`, `PermissionRequest`, `Stop` entries (idempotent merge, backup, clean uninstall — verified against a temp
`CODEX_HOME`) and does not use `--dangerously-bypass-hook-trust`.

## 5. Native session id capture and resume — PASS (Claude), partial (Codex)
- Claude: id pre-assigned; the app was restarted, the persisted session showed `CLOSED` (runtime state is never persisted),
  and **Resume** ran `claude --resume <id>` in the stored directory and restored the same conversation.
- Codex: new-session id capture is covered by the fixture test; `codex resume <SESSION_ID>` was verified from `--help`
  (accepts a UUID) but **not executed live**.
- Duplicate protection: a native conversation can't run in two sessions (unit-tested).

## 6–7. Whisper.cpp in Docker — PASS
Official image (pinned by digest) with `whisper-server`; `small.en` (465 MB) downloaded into a persistent volume by
`setup.sh`. 9.6 s of audio transcribed in **1.8 s (RTF 0.19)**, 3 runs, accurate ("24 tests" for "twenty four"); container RSS **≈650 MB**.
The renderer converts recordings to 16 kHz mono WAV, so no ffmpeg is needed in the STT image.

## 8–10. Chatterbox Turbo on CPU — WORKS, but SLOWER THAN REAL TIME
Measured with `node scripts/benchmark-audio.mjs` (default voice, 6 torch threads, 3 runs after warm-up):

| Text | Audio | Wall (best) | RTF (gen/audio) |
|---|---|---|---|
| 31 chars | 1.76 s | **4.5 s** | 2.54 |
| 76 chars | 4.08 s | 9.3 s | 2.28 |
| 171 chars | 9.68 s | 20.8 s | 2.15 |

- Model load: 63 s on first start (includes ~GBs of download), 8–11 s afterwards. Memory: **≈4.2 GiB** resident.
- Voice profile creation (conditioning from a reference clip): 1.9 s, then cached. Voice switching adds **no measurable
  latency** (default 8.5 s → cloned 7.9 s → default 9.0 s → cloned 7.7 s for the same sentence) and each synth call assigns that
  voice's own conditioning under a lock, so voices never leak between sessions. Cloned output differs from default (verified).
- **The ~2 s time-to-first-audio target is NOT met**: best case ≈4.5 s for a very short sentence, and RTF > 1 means longer
  text cannot stream without gaps. Increasing torch threads 6 → 12 gave no improvement.
- Per the brief, **Turbo remains the selected model** and nothing was silently swapped. Mitigations already in place:
  sentence-level chunking with a short first chunk and pipelined synthesis, a 400-character default speech limit, `<voice>`
  summaries, and progress expiry so stale updates are dropped. If this is unacceptable day-to-day, next steps to evaluate
  *(not done)*: Chatterbox **Nano** (`from_pretrained(nano=True)`, advertised ≈3× real time on 8 cores), Kokoro, or the optional GPU compose profile.

## End-to-end checks that passed in the running app
Create session → real Claude → prompt injected with bracketed paste → hooks → reorder → normalization → activity panel
(progress + result) → state IDLE; app restart → session listed as closed → resume; conversational mode → final result
synthesized by Chatterbox and played (`spoken_messages` row stored); events persisted in MySQL and history reloaded.
Bugs found and fixed through this testing: IPC handlers registered after the window loaded; `sessions:select` payload shape
(which also left the renderer deaf to events); window close with live agents left a windowless zombie process.

## Not tested (be skeptical of these)
- Microphone capture (`MediaRecorder` → WAV → STT) in the renderer and the recording shortcut: no human voice available;
  only the STT service and IPC transcription endpoint were exercised.
- Claude `PermissionRequest`, `Notification`, `AskUserQuestion`, `StopFailure`, `PostToolUseFailure` payloads live
  (implemented from the official docs, unit-tested with synthetic payloads).
- Codex hooks (trust flow), Codex permission detection, `codex resume` live, Codex App Server (docs only; not used).
- Multi-session background speaking with real audio, global mute, replay button, VS Code button, window-focus transitions.
- AppImage/deb artifacts (only `electron-builder --linux dir` was built and launched), macOS, GPU profile.
