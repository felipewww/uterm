#!/usr/bin/env node
// Explicit, idempotent hook installation. Usage: node hooks/install.mjs install|uninstall|status
//
//  claude: writes ~/.local/state/echo-term/claude-hooks.settings.json (passed to Claude via --settings).
//          Your ~/.claude/settings.json is never modified.
//  codex:  merges Echo-Term entries into ~/.codex/hooks.json, preserving every other hook.
//          Entries are recognised by their command path; install twice = no duplicates.
//          Codex requires you to trust new hooks once: run `/hooks` inside Codex and approve.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const claudeScript = resolve(here, 'claude', 'hook.mjs')
const codexScript = resolve(here, 'codex', 'hook.mjs')
const stateDir = join(homedir(), '.local', 'state', 'echo-term')
const claudeSettings = join(stateDir, 'claude-hooks.settings.json')
const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
const codexHooks = join(codexHome, 'hooks.json')
const MARK = 'echo-term/hooks/'

const template = (agent, script) =>
  JSON.parse(readFileSync(join(here, agent, 'hooks.template.json'), 'utf8').replaceAll('__HOOK_SCRIPT__', script))

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, path)
}

const isOurs = (h) => typeof h?.command === 'string' && (h.command.includes(MARK) || h.command.includes(codexScript))

function stripOurs(cfg) {
  const hooks = cfg.hooks ?? {}
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = (groups ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length > 0)
    if (kept.length) hooks[event] = kept
    else delete hooks[event]
  }
  cfg.hooks = hooks
  return cfg
}

function installCodex() {
  const current = existsSync(codexHooks) ? JSON.parse(readFileSync(codexHooks, 'utf8')) : {}
  const cfg = stripOurs(current) // idempotent: remove our previous entries first
  const ours = template('codex', codexScript).hooks
  for (const [event, groups] of Object.entries(ours)) cfg.hooks[event] = [...(cfg.hooks[event] ?? []), ...groups]
  if (existsSync(codexHooks) && !existsSync(codexHooks + '.echo-term.bak')) {
    writeFileSync(codexHooks + '.echo-term.bak', readFileSync(codexHooks))
  }
  atomicWrite(codexHooks, JSON.stringify(cfg, null, 2) + '\n')
}

function uninstallCodex() {
  if (!existsSync(codexHooks)) return
  const cfg = stripOurs(JSON.parse(readFileSync(codexHooks, 'utf8')))
  if (Object.keys(cfg.hooks).length === 0 && Object.keys(cfg).filter((k) => k !== 'hooks' && k !== 'description').length === 0) rmSync(codexHooks)
  else atomicWrite(codexHooks, JSON.stringify(cfg, null, 2) + '\n')
}

const cmd = process.argv[2]
if (cmd === 'install') {
  atomicWrite(claudeSettings, JSON.stringify(template('claude', claudeScript), null, 2) + '\n')
  console.log(`claude: wrote ${claudeSettings} (used via --settings; ~/.claude untouched)`)
  installCodex()
  console.log(`codex:  merged Echo-Term hooks into ${codexHooks}. Run /hooks in Codex once to trust them.`)
} else if (cmd === 'uninstall') {
  rmSync(claudeSettings, { force: true })
  uninstallCodex()
  console.log('removed Echo-Term hooks (other hooks preserved)')
} else if (cmd === 'status') {
  const c = existsSync(claudeSettings)
  let x = false
  if (existsSync(codexHooks)) x = JSON.stringify(JSON.parse(readFileSync(codexHooks, 'utf8'))).includes(codexScript.replaceAll('\\', '\\\\'))
  console.log(`claude: ${c ? 'installed' : 'not installed'}`)
  console.log(`codex:  ${x ? 'installed' : 'not installed'}`)
  process.exit(c && x ? 0 : 1)
} else {
  console.error('usage: install.mjs install|uninstall|status')
  process.exit(2)
}
