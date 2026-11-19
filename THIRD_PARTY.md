# Third-party software and models

uTerm is MIT-licensed (see `LICENSE`). It builds on, and runs in containers, the following projects; each keeps its own license.

| Project | Used for | License |
|---|---|---|
| [Electron](https://www.electronjs.org/), [Vue 3](https://vuejs.org/), [Vite](https://vitejs.dev/) | Desktop shell and UI | MIT |
| [xterm.js](https://xtermjs.org/), [node-pty](https://github.com/microsoft/node-pty) | Embedded terminals | MIT |
| [mysql2](https://github.com/sidorares/node-mysql2), [zod](https://zod.dev/) | Database access, input validation | MIT |
| [MySQL](https://www.mysql.com/) 8.4 (Docker image) | Local database | GPL-2.0 (the server runs unmodified in its own container) |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and OpenAI Whisper models | Local speech-to-text | MIT |
| [Chatterbox / Chatterbox Turbo](https://github.com/resemble-ai/chatterbox) by Resemble AI | Local text-to-speech and voice cloning | MIT (output carries Resemble's Perth watermark) |
| [FastAPI](https://fastapi.tiangolo.com/), [PyTorch](https://pytorch.org/) | TTS service | MIT / BSD-3 |

The full dependency list, with exact versions, is in `desktop/package-lock.json` and `services/*/requirements.txt`.
Model weights are downloaded at setup time from their publishers and are not part of this repository; check their licenses before
redistributing them.

## Trademarks
Claude and Claude Code are trademarks of Anthropic. Codex and OpenAI are trademarks of OpenAI. Kiro is a product of Amazon Web
Services. Gemini is a trademark of Google. uTerm is an independent project and is **not affiliated with, endorsed by, or sponsored
by** any of them; these names are used only to say which tools it works with.
