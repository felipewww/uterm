import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Minimal .env parser (no dependency). Real environment variables win. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    let v = line.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, eq).trim()] = v
  }
  return out
}

/** Repo root in dev (…/desktop/out/main → ../../..), overridable via ECHO_TERM_ROOT. */
export function findRepoRoot(startDir: string): string | null {
  if (process.env.ECHO_TERM_ROOT) return resolve(process.env.ECHO_TERM_ROOT)
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'hooks', 'claude', 'hook.mjs'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

/**
 * API keys used to live in .env files. Only read once, to carry them into the app's own encrypted key store (see secrets.ts);
 * after that the files are never consulted.
 */
export function readLegacyKeys(root: string | null): Partial<Record<'openai' | 'gemini', string>> {
  const files = [root && join(root, '.env'), join(homedir(), '.config', 'echo-term', '.env')].filter(Boolean) as string[]
  const out: Partial<Record<'openai' | 'gemini', string>> = {}
  for (const f of files) {
    if (!existsSync(f)) continue
    const env = parseEnvFile(readFileSync(f, 'utf8'))
    for (const p of ['openai', 'gemini'] as const) { const v = env[`ECHO_TERM_${p.toUpperCase()}_API_KEY`]?.trim(); if (v && !out[p]) out[p] = v }
  }
  return out
}

/** Everything else those old files defined: kept out of the environment of agents and terminals. */
export function readEnvFiles(root: string | null): Record<string, string> {
  const files = [root && join(root, '.env'), join(homedir(), '.config', 'echo-term', '.env')].filter(Boolean) as string[]
  let fileEnv: Record<string, string> = {}
  for (const f of files) if (existsSync(f)) fileEnv = { ...parseEnvFile(readFileSync(f, 'utf8')), ...fileEnv }
  return fileEnv
}

export function runtimeDir(): string {
  const base = process.env.XDG_RUNTIME_DIR ?? `/tmp/echo-term-${process.getuid?.() ?? 'u'}`
  return join(base, 'echo-term')
}

export const socketPath = (): string => join(runtimeDir(), 'hooks.sock')
export const stateDir = (): string => join(homedir(), '.local', 'state', 'echo-term')
