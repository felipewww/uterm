# Security

uTerm runs coding agents that can read and write your files and run commands, so its security model matters. This page says what
it protects, what it does not, and how to report a problem.

## Reporting a vulnerability
Please **do not open a public issue** for a security problem. Use GitHub's private reporting: **Security → Report a vulnerability**
on https://github.com/felipewww/uterm. Include what you found, how to reproduce it, and the version or commit. You will get an
answer as soon as possible; this is a small project maintained in spare time, so please allow a few days.

## Threat model
uTerm is a **single-user desktop app** that trusts the logged-in user and the agent CLIs they installed. It is not a sandbox for
untrusted agents or untrusted code, and it is not designed to be exposed to a network.

## What uTerm does to stay safe
- **Nothing is exposed to the network.** The app itself listens on nothing but its hook socket. The optional Chatterbox Docker server binds to `127.0.0.1` only and has no
  authentication, so any program running as a user on the same machine can talk to it: do not run it on a shared machine with untrusted local users. If you point uTerm at a Chatterbox server elsewhere, the text of spoken replies goes there.
- **The real agent CLIs stay in charge.** uTerm never answers a permission prompt or a question for you, never scrapes the terminal
  to decide anything, and holds back typed/spoken text while a prompt is on screen.
- **Hook channel:** a Unix socket in `$XDG_RUNTIME_DIR`, directory mode `0700`, socket mode `0600`. Hook scripts ignore processes
  that are not launched by uTerm, forward JSON only, and never print or fail the agent.
- **No shell strings from agent output.** Commands are launched with fixed argument arrays; every IPC payload is validated with zod;
  the renderer is sandboxed (`contextIsolation`, no `nodeIntegration`, `sandbox`, a strict Content-Security-Policy, navigation blocked,
  only `https:` links opened externally). Markdown from agents is HTML-escaped before it is rendered.
- **Your configuration is left alone.** Claude hooks are passed per process with `--settings`; Codex receives per-process `-c`
  overrides. The only user file uTerm edits is `~/.codex/hooks.json` (when you run the hook installer), with a backup and a clean uninstall.
- **Secrets:** cloud API keys are typed in Settings and kept in their own file, encrypted with the operating system's key storage
  (Electron `safeStorage`: Keychain on macOS, the desktop keyring on Linux; file mode `600`). Without such storage a key lives in memory only, until you quit.
  They are never stored in the database, never logged, redacted from error messages, never shown in the interface again, never sent anywhere except the
  provider's own API host, and are not in the environment of the agents uTerm launches (any `ECHO_TERM_*` variable ending in `API_KEY`, `SECRET`, `TOKEN` is removed too).
- **Recordings stay in memory** and are dropped after transcription.
- **No telemetry.**

## What leaves your machine
By default **nothing**. Data leaves only when you turn a cloud feature on, and only to the provider you chose:

| Feature (all off by default) | What is sent | To |
|---|---|---|
| A cloud voice (OpenAI or Gemini) for spoken replies | The text of the replies that get spoken | That provider |
| Cloud transcription | Your recorded audio | That provider |
| English coach | What you type or say (text), to rewrite it more naturally | OpenAI |

The agents themselves (Claude Code, Codex, Kiro) talk to their own vendors exactly as they do outside uTerm.
The local database stores session titles, folders, the structured activity feed (including agent replies) and, if you enable it, English
coach history, in one SQLite file in the app's data folder (`~/.config/echo-term-desktop/data/uterm.db` on Linux). Treat that file like your shell history.

## Known limitations
- Local speech services are unauthenticated on `127.0.0.1` (see above).
- Voice cloning: only clone voices you have the right to use. Chatterbox adds an imperceptible watermark to its output.
- Cost figures are estimates, not a bill.
- macOS and Windows are untested; see `docs/technical-validation.md` for everything that was and was not verified.
