import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export interface DbConfig { host: string; port: number; database: string; user: string; password: string }

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
    if (existsSync(join(dir, 'hooks', 'claude', 'hook.mjs')) && existsSync(join(dir, 'database', 'migrations'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

export function loadEnv(root: string | null): Record<string, string | undefined> {
  const files = [root && join(root, '.env'), join(homedir(), '.config', 'echo-term', '.env')].filter(Boolean) as string[]
  let fileEnv: Record<string, string> = {}
  for (const f of files) {
    if (existsSync(f)) { fileEnv = { ...parseEnvFile(readFileSync(f, 'utf8')), ...fileEnv } }
  }
  return { ...fileEnv, ...process.env }
}

export function dbConfigFromEnv(env: Record<string, string | undefined>): DbConfig | null {
  const password = env.ECHO_TERM_DB_PASSWORD
  if (!password) return null
  return {
    host: env.ECHO_TERM_DB_HOST ?? '127.0.0.1',
    port: Number(env.ECHO_TERM_DB_PORT ?? 33306),
    database: env.ECHO_TERM_DB_NAME ?? 'echo_term',
    user: env.ECHO_TERM_DB_USER ?? 'echo_term',
    password
  }
}

export function runtimeDir(): string {
  const base = process.env.XDG_RUNTIME_DIR ?? `/tmp/echo-term-${process.getuid?.() ?? 'u'}`
  return join(base, 'echo-term')
}

export const socketPath = (): string => join(runtimeDir(), 'hooks.sock')
export const stateDir = (): string => join(homedir(), '.local', 'state', 'echo-term')
