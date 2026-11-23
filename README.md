<p align="center">
  <img src="docs/images/logo.svg" alt="uTerm — voice-first workspace for your coding agents" width="760">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5ac8ff?style=flat-square"></a>
  <img alt="Linux and macOS" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS-6fb0ff?style=flat-square">
  <img alt="Electron and Vue 3" src="https://img.shields.io/badge/Electron%20%2B%20Vue%203-8f9bff?style=flat-square">
  <img alt="local-first" src="https://img.shields.io/badge/local--first-b58cff?style=flat-square">
</p>

<h3 align="center">A local-first desktop workspace for talking to your coding agents, by keyboard or by voice.</h3>

uTerm runs the **real, interactive [Claude Code](https://www.anthropic.com/claude-code), [Codex CLI](https://github.com/openai/codex) and
[Kiro CLI](https://kiro.dev)** in embedded terminals and adds named, resumable sessions, folders, a structured activity feed,
spoken updates when an agent finishes or needs you, and voice input. It is a workspace around the CLIs, not a replacement:
uTerm never answers a permission prompt for you and never puts a chat UI between you and the agent.

## Features
- **Sessions:** several agents at once, each in its own terminal; resume and import existing conversations; nested folders; live state (working, needs input, error); several Claude accounts; plain shell terminals.
- **Voice input:** Whisper runs inside the app (offline, nothing to install). Record, review the text, send.
- **Spoken replies:** per-session modes (silent, essential, balanced, conversational). Default voice is the system one (`say` on macOS, `espeak-ng` on Linux); optionally a [Chatterbox](https://github.com/resemble-ai/chatterbox) server by URL, or Google Gemini / OpenAI with your own API key.
- **Activity feed:** prompts, progress, tool calls, approvals and results, read from hooks and session logs, never from the screen.
- **English coach** (optional) and a **cloud cost estimate**, both off by default.

## Install
Pre-built packages are produced by you with the commands in [Build](#build); there is no hosted release yet.

| Platform | Package | How to install |
|---|---|---|
| Linux | `uTerm-0.1.0.AppImage` or `.deb` | `chmod +x` and run the AppImage, or `sudo apt install ./uterm-desktop_0.1.0_amd64.deb` |
| macOS (Apple Silicon) | `uTerm-0.1.0-arm64-mac.zip` | Unzip, move `uTerm.app` to `/Applications`, then `xattr -cr /Applications/uTerm.app && codesign --force --deep --sign - /Applications/uTerm.app` (the build is unsigned) |

You also need at least one agent CLI installed and logged in (Claude Code, Codex or Kiro). On Linux, `sudo apt install espeak-ng` gives the default voice.

## Run from source
Requires Node.js ≥ 22 and `build-essential` (for node-pty). No Docker.
```bash
git clone https://github.com/felipewww/uterm.git
cd uterm
./scripts/setup.sh    # checks prerequisites, installs dependencies and the agent hooks
./scripts/dev.sh      # starts the app; same data and engines as the installed one
```
Diagnostics: `./scripts/doctor.sh`. If Electron aborts with a SUID-sandbox error, `dev.sh` falls back to `--no-sandbox` and prints the manual fix.

## Build
```bash
cd desktop
npm run package        # Linux: release/*.AppImage and release/*.deb
npm run package:mac    # macOS zips, arm64 and x64. Run it on a Mac
```
Cross-building the macOS zip from Linux works with:
```bash
npm run build && MAC_ARCH=arm64 npx electron-builder --mac --config build/mac-config.cjs -c.npmRebuild=false
```
Notes:
- The Whisper model (~77 MB) is bundled into both packages. Fetch it first with `./scripts/fetch-stt-model.sh` if `desktop/build/models` is empty.
- Output goes to `desktop/release/` and is not tracked by git.
- macOS builds are **unsigned and not notarized**, hence the `xattr`/`codesign` step above.

## Use it
- **＋** creates a session or imports an existing conversation. Right-click a session for more actions.
- **Record:** `Ctrl+Shift+Space` (`⌘⇧Space` on a Mac). **Send** the reviewed text: `Ctrl+Enter` (`⌘Enter`), from anywhere in the window.
- **Settings → Voice** has three tabs. *Output* picks the speech engine and voice, *Input* the transcription engine and microphone, *Behavior* the voice modes. The other panes are General, English coach, Usage and System.
- **API keys** (OpenAI, Gemini) are typed in Settings → Voice and stored encrypted by the OS (Keychain, keyring). They never go to the database, the logs or the agents. Costs shown are estimates; your provider's dashboard has the real bill.

## Optional: Chatterbox server
More natural voices and voice cloning, run by you in Docker (about 6 GB of RAM on CPU, or an NVIDIA GPU):
```bash
docker compose up -d tts          # http://127.0.0.1:18090
./scripts/tts-gpu.sh              # GPU flavour (--cpu to go back); ./scripts/stop.sh to stop
```
Then choose **Chatterbox server** in Settings → Voice → Output and enter the URL. On a Mac it runs on CPU only and can be slow.

## Data
One SQLite file: `~/.config/echo-term-desktop/data/uterm.db` on Linux, `~/Library/Application Support/uTerm/data/uterm.db` on macOS. Coming from the old Docker/MySQL version: `cd desktop && npm i --no-save mysql2 && cd .. && node scripts/import-mysql.mjs`.

## Development
```bash
cd desktop && npm run typecheck && npm run lint && npm run test
```
`desktop/` is the Electron app, `services/tts` the optional voice server, `hooks/` the agent hook forwarder, `docs/` the design notes ([architecture](docs/architecture.md), [design system](docs/design-system.md)). Add an agent by implementing `AgentAdapter` (`desktop/src/main/agents`). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Status
Young software. Developed on Linux; the macOS build (Apple Silicon) has been used by its author but is unsigned. Windows is not supported. [`docs/technical-validation.md`](docs/technical-validation.md) lists what was measured and what was **not** tested. Bug reports with `./scripts/doctor.sh` output are welcome.

## Privacy and security
No telemetry. Ports bind to `127.0.0.1`, recordings stay in memory, cloud features are opt-in. What leaves your machine, and how to report a vulnerability: [SECURITY.md](SECURITY.md).

## License
[MIT](LICENSE). Third-party components: [THIRD_PARTY.md](THIRD_PARTY.md). uTerm is independent and not affiliated with Anthropic, OpenAI, Google or Amazon.
