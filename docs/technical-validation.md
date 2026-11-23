# Technical validation (Milestone 0)

Everything below was **executed on this machine** (Ubuntu 25.10, Ryzen 7 / 16 threads, 32 GB, GTX 1650 (4 GB; unused until the GPU test below),
Docker 29.4, Node 22.23) unless it is explicitly listed under *Not tested*. Versions: Claude Code 2.1.328,
Codex CLI 0.169.0, Electron 45.4, node-pty 1.1.0, xterm.js 6.0, whisper.cpp (official image, `small.en`),
Chatterbox 0.1.7 (`ChatterboxTurboTTS`, PyTorch 2.6.0 CPU, Python 3.11).

## 1. Real CLIs in node-pty + xterm.js — PASS
- Claude Code and Codex both run inside node-pty (`tests/smoke/agent-smoke.cjs`) and Claude renders correctly in
  xterm.js inside the Electron app (colors, box drawing, bracketed paste, resize, footer, scrollback).
- Gotcha: Claude shows a folder-trust dialog on first use of a directory; uTerm never answers it for you.
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
carries `last_agent_message`; prompts are `item_completed` / `UserMessage`. uTerm tails the file read-only (polling,
byte offset) and never replaces the interactive CLI. The native session id comes from `session_meta`; for new sessions the
rollout is discovered by creation time + `cwd`. Captured and scrubbed as `tests/fixtures/codex-turn.jsonl`.
Codex hooks exist (`~/.codex/hooks.json`) but **require a one-time trust review via `/hooks`**; uTerm installs only
`SessionStart`, `PermissionRequest`, `Stop` entries (idempotent merge, backup, clean uninstall — verified against a temp
`CODEX_HOME`) and does not use `--dangerously-bypass-hook-trust`.

## 4b. Kiro CLI — PASS via session-log tailing (kiro-cli 2.34, Linux)
Run live (`tests/smoke/kiro-smoke.cjs`, real `kiro-cli chat` in a PTY, one no-tool prompt, scratch directory):
- Starting a session creates `~/.kiro/sessions/cli/<id>.json|.jsonl|.lock|.history` within ~2.5 s. `<id>.json` carries `session_id`,
  `cwd`, `created_at`, `title`; `.lock` carries the process pid. New sessions are discovered by creation time + `cwd`, like Codex.
- `<id>.jsonl` is one `{version, kind, data}` per line: `Prompt`, `AssistantMessage` (content blocks `thinking`/`text`/`toolUse`) and
  `ToolResults`. A turn ends on an `AssistantMessage` without `toolUse`; text before a tool call is progress. Parsed by
  `KiroTranscriptParser`; checked against two real logs (8-message tool session: 1 prompt, 7 progress, 7 tools, 1 final) and a
  synthetic fixture (`tests/fixtures/kiro-session.jsonl`, same structure, invented content).
- `kiro-cli chat --resume-id <id>` reuses the same session files (no new `.json`) and restores the conversation: Resume tails from the end.
- No workspace-trust prompt appeared in a scratch directory.
- **Not detectable:** permission prompts and cancelled turns are not written to the log. Kiro hooks (custom agent config) and ACP
  (`kiro-cli acp`) exist but were not used: a custom agent would change the user's Kiro behaviour, and ACP replaces the CLI UI.
  `~/.kiro` is read-only for uTerm.
- Speech instructions: Kiro has no system-prompt flag, so a NEW session is started as `kiro-cli chat "<instructions + ask for a greeting>"` (first message; resumed sessions already carry it). Run live: Kiro answered with a one-line greeting (it even used a `[happy]` tag) and the Activity hides the priming message (marker `[uTerm voice setup]`). Imported/resumed Kiro conversations that were not started by uTerm do not get the instructions.
- Detection: `kiro-cli` is looked up in PATH **and** the usual install folders (`~/.local/bin`, `/opt/homebrew/bin`, …) because a
  GUI-launched app does not inherit the shell PATH (matters on macOS). Covered by unit tests; not run on macOS.

## 5. Native session id capture and resume — PASS (Claude), partial (Codex)
- Claude: id pre-assigned; the app was restarted, the persisted session showed `CLOSED` (runtime state is never persisted),
  and **Resume** ran `claude --resume <id>` in the stored directory and restored the same conversation.
- Codex: new-session id capture is covered by the fixture test; `codex resume <SESSION_ID>` was verified from `--help`
  (accepts a UUID) but **not executed live**.
- Duplicate protection: a native conversation can't run in two sessions (unit-tested).

## 6–7. Whisper.cpp in Docker — PASS (historical: replaced by the in-app Whisper, see the next section)
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

### GPU run (GTX 1650, 4 GB) — measured
Same model and code, `TTS_DEVICE=cuda`, CUDA 12.4 torch wheels, container started with plain device mapping plus the driver libraries
(`libcuda`, `libnvidia-ptxjitcompiler`, `libnvidia-nvvm`, `libnvidia-gpucomp`, `libnvidia-ml`); without the ptxjit library the vocoder fails with
`CUFFT_INTERNAL_ERROR`. Model load 14 s, 2.6 GiB VRAM idle, ~3.0 GiB peak. Results: 98 chars → 2.5 s for 5.7 s of audio (RTF 0.45); 211 chars → 6.2 s for
13.9 s of audio (RTF 0.45). The same ~12-14 s clips took 23-29 s on CPU (RTF 2.0-2.1). CPU profile: ~85% of the time is the T3 token loop (≈14 tokens/s,
real time needs 25); the S3Gen vocoder is ~3 s and watermarking is negligible. Dynamic int8 quantisation of `nn.Linear` gave no gain (GPT-2 uses `Conv1D`).
Quality was not assessed by ear.

## End-to-end checks that passed in the running app
Create session → real Claude → prompt injected with bracketed paste → hooks → reorder → normalization → activity panel
(progress + result) → state IDLE; app restart → session listed as closed → resume; conversational mode → final result
synthesized by Chatterbox and played (`spoken_messages` row stored); events persisted in MySQL (the database at that time; it is SQLite now) and history reloaded.
Bugs found and fixed through this testing: IPC handlers registered after the window loaded; `sessions:select` payload shape
(which also left the renderer deaf to events); window close with live agents left a windowless zombie process.

## Cloud voice (OpenAI, Gemini) — implemented, NOT run against the real APIs
Written from the providers' public documentation and covered by unit tests with a mocked `fetch` (request shapes, key in a header, WAV wrapping of Gemini's 16-bit PCM, error mapping, model discovery, usage totals, cost estimates, router and self-test). Nothing was called with a real key from this development environment: the first real calls are the **Test** buttons in Settings → Cloud voice. Model names (e.g. `gemini-2.5-flash-preview-tts`) and list prices change; both are editable/estimated in the app. Gemini/OpenAI transcription of 16 kHz WAV uploads was not exercised.

## Standard setup without Docker (SQLite, in-app Whisper, system voice, key store) — PARTLY verified
- **Verified on Linux:** unit tests (secret store with a fake cipher, router fallbacks, SQLite stores); the built app started against a copy of the
  real data and loaded the 10 sessions, 347 events, folders and settings imported from the old MySQL by `scripts/import-mysql.mjs`; the Settings → Voice engines screen
  rendered; saving and removing an API key went through Electron `safeStorage` (keyring available here); keys from an old `.env` moved into the store on first launch;
  Whisper (ONNX) transcribed a sample correctly in about 2 s on this CPU.
- **Not verified:** everything on macOS (the Whisper model/ONNX/sharp packaging, `say` and `afconvert`, Keychain-backed `safeStorage`, speed on Apple Silicon);
  the system voice on Linux here (this machine has no `espeak-ng`, so the app reports it as unavailable); a live Chatterbox server through the new engine setting
  (the client code is unchanged and covered by its unit tests); the fallback to the system voice with a real dead server.

## Not tested (be skeptical of these)
- Microphone capture (`MediaRecorder` → WAV → STT) in the renderer and the recording shortcut: no human voice available;
  only the STT service and IPC transcription endpoint were exercised.
- Claude `PermissionRequest`, `Notification`, `AskUserQuestion`, `StopFailure`, `PostToolUseFailure` payloads live
  (implemented from the official docs, unit-tested with synthetic payloads).
- Codex hooks (trust flow), Codex permission detection, `codex resume` live, Codex App Server (docs only; not used).
- Kiro: tool-using turns live inside uTerm (only parsed from existing logs), the V3 engine (`--v3`/TUI), macOS paths, permission detection (not possible from the log).
- Multi-session background speaking with real audio, global mute, the listen-again buttons in Activity, VS Code button, window-focus transitions.
- AppImage/deb artifacts (only `electron-builder --linux dir` was built and launched), macOS, GPU profile.
