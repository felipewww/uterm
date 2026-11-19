import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, which } from './agents/exec'

export type ServiceName = 'stt' | 'tts'
export interface ServiceFlags { stt: boolean; tts: boolean }
export const SERVICE_NAMES: ServiceName[] = ['stt', 'tts']

/** Local, git-ignored file with the user's on/off choice. scripts/dev.sh reads it too, so a service turned off stays off. */
export const SERVICES_FILE = '.services.local'

export function readDesired(root: string | null): ServiceFlags {
  const flags: ServiceFlags = { stt: true, tts: true }
  if (!root) return flags
  try {
    for (const line of readFileSync(join(root, SERVICES_FILE), 'utf8').split('\n')) {
      const m = /^\s*(stt|tts)\s*=\s*(on|off)\s*$/.exec(line)
      if (m) flags[m[1] as ServiceName] = m[2] === 'on'
    }
  } catch { /* no file: everything on */ }
  return flags
}

export function writeDesired(root: string, patch: Partial<ServiceFlags>): ServiceFlags {
  const next = { ...readDesired(root), ...patch }
  writeFileSync(join(root, SERVICES_FILE), `stt=${next.stt ? 'on' : 'off'}\ntts=${next.tts ? 'on' : 'off'}\n`)
  return next
}

type Exec = (file: string, args: string[], timeoutMs: number, cwd?: string) => Promise<string>

/**
 * Stops or starts one Docker service (its memory is freed while it is off) and records the choice.
 * Fixed argv, no shell. `docker compose` reads the repo's .env, so a GPU override (COMPOSE_FILE) is respected.
 */
export async function setService(root: string | null, name: ServiceName, enabled: boolean, exec: Exec = run): Promise<ServiceFlags> {
  if (!SERVICE_NAMES.includes(name)) throw new Error('Unknown service')
  if (!root || !existsSync(join(root, 'docker-compose.yml'))) throw new Error('The voice services are not managed from this install (no docker-compose.yml next to the app).')
  const docker = await which('docker')
  if (!docker) throw new Error('Docker was not found on this machine.')
  const args = ['compose', '--project-directory', root, ...(enabled ? ['up', '-d', name] : ['stop', name])]
  // cwd = the repo root: COMPOSE_FILE in .env (the GPU override) holds paths relative to it, not to --project-directory
  try { await exec(docker, args, enabled ? 180_000 : 90_000, root) } catch (err) {
    throw new Error(`Could not ${enabled ? 'start' : 'stop'} ${name.toUpperCase()}: ${(err as Error).message.split('\n')[0]}`)
  }
  return writeDesired(root, { [name]: enabled })
}
