# Contributing

Thanks for your interest in uTerm! Small, focused pull requests are easiest to review.

## Set up
```bash
./scripts/setup.sh                # first time: prerequisites, dependencies, hooks
npm run dev                       # in desktop/, or ../scripts/dev.sh (no Docker needed)
```

## Before you open a PR
```bash
cd desktop
npm run typecheck && npm run lint && npm run test && npm run build
```
Python tests for the TTS service are in
`CLAUDE.md` / `docs/`. Please add or update tests with your change, and keep `docs/technical-validation.md` honest about what you
did **not** test.

## Ground rules
- The real agent CLIs stay in the terminal. Do not replace them with a chat UI, scrape terminal output for meaning, or answer
  permission prompts automatically.
- Anything that sends data off the machine must be **opt-in**, documented in `SECURITY.md`, and must never put a key in the
  database, a log, or an agent's environment.
- Validate every IPC input with zod; never build shell strings from agent or user text.
- Colours and sizes come from the design tokens in `desktop/src/renderer/design` (see `docs/design-system.md`); no hardcoded colours.
- Add a new agent by implementing `AgentAdapter` (see `desktop/src/main/agents`); do not touch the PTY manager, audio queue or voice policy.

## Reporting bugs and security issues
Bugs: open an issue with steps, your OS, Node versions and the relevant lines from `./scripts/doctor.sh`.
Security problems: see `SECURITY.md` (please do not file them publicly).
