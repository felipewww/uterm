import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Directories where agent CLIs are commonly installed. A GUI-launched app (macOS Finder/Dock, Linux launchers) does not inherit
 * the shell PATH, so `kiro-cli` in ~/.local/bin or `claude` in /opt/homebrew/bin would otherwise look "not installed".
 */
export function extraBinDirs(home = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  const dirs = [
    join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.cargo', 'bin'), join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.deno', 'bin'), '/usr/local/bin', '/usr/bin'
  ]
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/opt/homebrew/sbin', '/Applications/Kiro CLI.app/Contents/MacOS')
  if (platform === 'linux') dirs.push('/home/linuxbrew/.linuxbrew/bin', '/snap/bin')
  return dirs
}

/** The inherited PATH first, then the usual install locations (no duplicates). */
export function searchPath(pathEnv = process.env.PATH ?? '', extra = extraBinDirs()): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const dir of [...pathEnv.split(delimiter), ...extra]) {
    if (dir && !seen.has(dir)) { seen.add(dir); out.push(dir) }
  }
  return out.join(delimiter)
}

/** Absolute path of an executable, searching PATH and the usual install locations; null when not installed. */
export async function which(cmd: string, pathEnv = searchPath()): Promise<string | null> {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const p = join(dir, cmd)
    try { await access(p, constants.X_OK); return p } catch { /* next */ }
  }
  return null
}

/** First of several command names that is installed (e.g. a renamed CLI). */
export async function whichAny(cmds: string[], pathEnv = searchPath()): Promise<string | null> {
  for (const c of cmds) { const p = await which(c, pathEnv); if (p) return p }
  return null
}

export function run(file: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}
