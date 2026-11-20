import { readFileSync } from 'node:fs'
import { cpus, freemem, loadavg, totalmem, uptime } from 'node:os'
import { run } from './agents/exec'

/** A deliberately small, htop-like view of the machine (CPU per thread, memory, swap) plus the process tree of one terminal. */
export interface CpuTimes { user: number; nice: number; sys: number; idle: number; irq: number }
const busy = (t: CpuTimes) => t.user + t.nice + t.sys + t.irq
const total = (t: CpuTimes) => busy(t) + t.idle

/** Per-thread utilisation (0-100) between two snapshots of os.cpus() times. */
export function cpuPercent(prev: CpuTimes[], cur: CpuTimes[]): number[] {
  return cur.map((c, i) => {
    const p = prev[i]
    if (!p) return 0
    const dt = total(c) - total(p)
    return dt > 0 ? Math.min(100, Math.max(0, ((busy(c) - busy(p)) / dt) * 100)) : 0
  })
}

export interface Meminfo { totalKb: number; availableKb: number; swapTotalKb: number; swapFreeKb: number }

export function parseMeminfo(text: string): Meminfo | null {
  const v = (k: string) => { const m = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(text); return m ? Number(m[1]) : null }
  const totalKb = v('MemTotal'); const availableKb = v('MemAvailable')
  if (totalKb === null || availableKb === null) return null
  return { totalKb, availableKb, swapTotalKb: v('SwapTotal') ?? 0, swapFreeKb: v('SwapFree') ?? 0 }
}

/** ps "etime": [[dd-]hh:]mm:ss -> seconds. */
export function parseEtime(s: string): number {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(s.trim())
  return m ? (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3]) * 60) + Number(m[4]) : 0
}

export interface Proc { pid: number; ppid: number; rssKb: number; pcpu: number; etime: number; comm: string }

/** Output of `ps -axo pid=,ppid=,rss=,pcpu=,etime=,comm=` (works on Linux and macOS). Only the executable name is kept, never the arguments. */
export function parsePs(text: string): Proc[] {
  const out: Proc[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (m) out.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), pcpu: Number(m[4]), etime: parseEtime(m[5]!), comm: m[6]!.split('/').pop()! })
  }
  return out
}

/** The root process and everything below it. */
export function subtree(procs: Proc[], rootPid: number): Proc[] {
  const kids = new Map<number, Proc[]>()
  for (const p of procs) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)!).push(p)
  const root = procs.find((p) => p.pid === rootPid)
  if (!root) return []
  const out: Proc[] = []; const seen = new Set<number>()
  const stack = [root]
  while (stack.length) {
    const p = stack.pop()!
    if (seen.has(p.pid)) continue
    seen.add(p.pid); out.push(p)
    stack.push(...(kids.get(p.pid) ?? []))
  }
  return out
}

/** utime + stime (clock ticks) from /proc/<pid>/stat, or null. */
export function parseStatTicks(stat: string): number | null {
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ') // after "pid (comm) "
  const u = Number(rest[11]); const s = Number(rest[12])
  return Number.isFinite(u) && Number.isFinite(s) ? u + s : null
}

export interface SystemSample {
  at: number
  cpu: { threads: number[]; total: number; model: string; load: [number, number, number] }
  memory: { totalKb: number; usedKb: number; availableKb: number; swapTotalKb: number; swapUsedKb: number }
  uptimeSec: number
  terminal?: { pid: number; uptimeSec: number; processes: number; cpu: number; rssKb: number; top: Array<{ pid: number; name: string; cpu: number; rssKb: number }> } | null
}

const CLK_TCK = 100

export class SystemSampler {
  private prevCpu: CpuTimes[] = cpus().map((c) => c.times)
  private prevTicks = new Map<number, number>()
  private prevAt = Date.now()

  async sample(rootPid: number | null): Promise<SystemSample> {
    const now = Date.now()
    const list = cpus()
    const threads = cpuPercent(this.prevCpu, list.map((c) => c.times))
    this.prevCpu = list.map((c) => c.times)
    const mi = (() => { try { return parseMeminfo(readFileSync('/proc/meminfo', 'utf8')) } catch { return null } })()
    const totalKb = mi?.totalKb ?? Math.round(totalmem() / 1024)
    const availableKb = mi?.availableKb ?? Math.round(freemem() / 1024) // on macOS "free" under-reports; the real number needs vm_stat
    const l = loadavg()
    const sample: SystemSample = {
      at: now,
      cpu: { threads, total: threads.length ? threads.reduce((a, b) => a + b, 0) / threads.length : 0, model: list[0]?.model ?? '', load: [l[0] ?? 0, l[1] ?? 0, l[2] ?? 0] },
      memory: { totalKb, availableKb, usedKb: Math.max(0, totalKb - availableKb), swapTotalKb: mi?.swapTotalKb ?? 0, swapUsedKb: mi ? Math.max(0, mi.swapTotalKb - mi.swapFreeKb) : 0 },
      uptimeSec: Math.round(uptime())
    }
    if (rootPid) sample.terminal = await this.terminal(rootPid, now)
    this.prevAt = now
    return sample
  }

  private async terminal(rootPid: number, now: number): Promise<SystemSample['terminal']> {
    let procs: Proc[] = []
    try { procs = parsePs(await run('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,etime=,comm='], 4000)) } catch { return null }
    const tree = subtree(procs, rootPid)
    if (!tree.length) return null
    const dt = Math.max(0.2, (now - this.prevAt) / 1000)
    const nextTicks = new Map<number, number>()
    const cpu = new Map<number, number>()
    for (const p of tree) {
      let pct = p.pcpu // lifetime average (macOS, or the first sample)
      try { // Linux: instantaneous, from the change in CPU ticks since the last sample
        const t = parseStatTicks(readFileSync(`/proc/${p.pid}/stat`, 'utf8'))
        if (t !== null) { nextTicks.set(p.pid, t); const prev = this.prevTicks.get(p.pid); if (prev !== undefined) pct = ((t - prev) / CLK_TCK / dt) * 100 }
      } catch { /* not Linux, or the process just ended */ }
      cpu.set(p.pid, Math.max(0, pct))
    }
    this.prevTicks = nextTicks
    const root = tree.find((p) => p.pid === rootPid)!
    return {
      pid: rootPid, uptimeSec: root.etime, processes: tree.length,
      cpu: [...cpu.values()].reduce((a, b) => a + b, 0),
      rssKb: tree.reduce((a, p) => a + p.rssKb, 0),
      top: tree.map((p) => ({ pid: p.pid, name: p.comm, cpu: cpu.get(p.pid) ?? 0, rssKb: p.rssKb })).sort((a, b) => b.cpu - a.cpu || b.rssKb - a.rssKb).slice(0, 5)
    }
  }
}
