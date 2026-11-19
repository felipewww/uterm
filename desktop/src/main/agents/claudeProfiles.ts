import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ClaudeProfile {
  /** null = the environment default (what a plain `claude` would use here) */
  dir: string | null
  /** absolute folder the profile resolves to */
  resolved: string
  label: string
}

const isDir = (p: string) => { try { return statSync(p).isDirectory() } catch { return false } }
const tilde = (p: string, home: string) => (p.startsWith(home + '/') ? '~' + p.slice(home.length) : p)

/**
 * Claude Code keeps each account's login, history and settings in its own config folder. Besides the default one
 * (`$CLAUDE_CONFIG_DIR` or `~/.claude`), people keep extras such as `~/.claude-me` behind a shell alias.
 */
export function claudeProfiles(env: NodeJS.ProcessEnv = process.env, home = homedir()): ClaudeProfile[] {
  const def = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const out: ClaudeProfile[] = [{ dir: null, resolved: def, label: `Default (${tilde(def, home)})` }]
  let names: string[] = []
  try { names = readdirSync(home) } catch { /* no home listing */ }
  for (const n of names.sort()) {
    if (!/^\.claude([-_.].+)?$/.test(n)) continue
    const p = join(home, n)
    if (p === def || !isDir(p) || !existsSync(join(p, 'projects'))) continue // only folders that really hold conversations
    out.push({ dir: p, resolved: p, label: tilde(p, home) })
  }
  return out
}

/** Short name for a profile folder: ~/.claude-me -> "me". */
export function profileName(dir: string): string {
  const base = dir.split('/').filter(Boolean).pop() ?? dir
  return base.replace(/^\.claude[-_.]?/, '') || base
}
