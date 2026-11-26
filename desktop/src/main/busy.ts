import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

/**
 * Is a command running in the foreground of a shell? The kernel knows: the terminal's foreground process group is then not the
 * shell's own. Nothing is read from the screen. Background jobs (`cmd &`, `docker compose up -d`) leave the shell idle.
 */
export const busyFromGroups = (pgrp: number, tpgid: number): boolean => tpgid > 0 && pgrp > 0 && tpgid !== pgrp

/** Linux /proc/<pid>/stat: "pid (name) state ppid pgrp session tty tpgid …"; the name may itself hold spaces and brackets. */
export function busyFromStat(stat: string): boolean {
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return busyFromGroups(Number(f[2]), Number(f[5]))
}

export async function isBusy(pid: number): Promise<boolean> {
  try {
    if (process.platform === 'linux') return busyFromStat(await readFile(`/proc/${pid}/stat`, 'utf8'))
    const out = await new Promise<string>((resolve, reject) => execFile('ps', ['-o', 'pgid=,tpgid=', '-p', String(pid)], { timeout: 2000 }, (err, stdout) => (err ? reject(err) : resolve(stdout))))
    const [pgrp, tpgid] = out.trim().split(/\s+/).map(Number)
    return busyFromGroups(pgrp ?? 0, tpgid ?? 0)
  } catch { return false } // gone, or not readable
}
