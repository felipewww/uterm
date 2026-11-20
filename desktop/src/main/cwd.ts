import { readlinkSync } from 'node:fs'
import { run, which } from './agents/exec'

/** `lsof -Fn` output (macOS): the line starting with "n" after the "fcwd" record is the directory. */
export function parseLsofCwd(out: string): string | null {
  const lines = out.split('\n')
  const i = lines.findIndex((l) => l === 'fcwd')
  const n = i >= 0 ? lines.slice(i + 1).find((l) => l.startsWith('n')) : undefined
  return n ? n.slice(1) : null
}

/** The working directory a process is in right now (Linux: /proc; macOS: lsof). Null when it cannot be read. */
export async function cwdOfPid(pid: number): Promise<string | null> {
  try { return readlinkSync(`/proc/${pid}/cwd`) } catch { /* not Linux, or the process ended */ }
  try {
    const lsof = await which('lsof')
    if (!lsof) return null
    return parseLsofCwd(await run(lsof, ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], 3000))
  } catch { return null }
}
