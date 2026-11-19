import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'

export async function which(cmd: string, pathEnv = process.env.PATH ?? ''): Promise<string | null> {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const p = join(dir, cmd)
    try { await access(p, constants.X_OK); return p } catch { /* next */ }
  }
  return null
}

export function run(file: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
  })
}
