import { describe, expect, it } from 'vitest'
import { cpuPercent, parseEtime, parseMeminfo, parsePs, parseStatTicks, subtree, SystemSampler } from '../src/main/system'

const t = (user: number, idle: number, sys = 0) => ({ user, nice: 0, sys, idle, irq: 0 })

describe('system: CPU, memory, processes', () => {
  it('computes per-thread utilisation from two snapshots', () => {
    const p = cpuPercent([t(100, 900), t(0, 1000)], [t(150, 950), t(0, 1100)])
    expect(p[0]).toBeCloseTo(50, 5) // 50 busy of 100 elapsed
    expect(p[1]).toBe(0)
    expect(cpuPercent([], [t(1, 1)])).toEqual([0]) // a thread with no previous snapshot
    expect(cpuPercent([t(5, 5)], [t(5, 5)])).toEqual([0]) // no time elapsed
  })
  it('reads available memory and swap from /proc/meminfo', () => {
    const m = parseMeminfo('MemTotal:       32000000 kB\nMemFree:         1000000 kB\nMemAvailable:   20000000 kB\nSwapTotal:       8000000 kB\nSwapFree:        7000000 kB\n')
    expect(m).toEqual({ totalKb: 32000000, availableKb: 20000000, swapTotalKb: 8000000, swapFreeKb: 7000000 })
    expect(parseMeminfo('nope')).toBeNull()
  })
  it('parses ps elapsed times', () => {
    expect(parseEtime('05:09')).toBe(309)
    expect(parseEtime('02:05:09')).toBe(7509)
    expect(parseEtime('3-02:05:09')).toBe(3 * 86400 + 7509)
    expect(parseEtime('garbage')).toBe(0)
  })
  it('parses ps output keeping only the executable name', () => {
    const procs = parsePs('  100     1  2048  0.5    10:00 /usr/bin/bash\n  200   100 51200 12.5    00:05 node\n  300   200  1024  0.0    00:01 /Applications/My App/helper\nbad line\n')
    expect(procs).toEqual([
      { pid: 100, ppid: 1, rssKb: 2048, pcpu: 0.5, etime: 600, comm: 'bash' },
      { pid: 200, ppid: 100, rssKb: 51200, pcpu: 12.5, etime: 5, comm: 'node' },
      { pid: 300, ppid: 200, rssKb: 1024, pcpu: 0, etime: 1, comm: 'helper' }
    ])
  })
  it('finds a process and everything below it, and nothing else', () => {
    const procs = parsePs('1 0 1 0 00:01 init\n100 1 1 0 00:01 sh\n200 100 1 0 00:01 node\n300 200 1 0 00:01 tsc\n400 1 1 0 00:01 other\n')
    expect(subtree(procs, 100).map((p) => p.pid).sort()).toEqual([100, 200, 300])
    expect(subtree(procs, 999)).toEqual([])
  })
  it('reads CPU ticks from /proc/<pid>/stat even when the command name has spaces and parentheses', () => {
    const stat = '123 (my (weird) cmd) S 1 123 123 0 -1 4194304 100 0 0 0 40 2 0 0 20 0 1 0 5000 1000000 200 18446744073709551615'
    expect(parseStatTicks(stat)).toBe(42)
    expect(parseStatTicks('garbage')).toBeNull()
  })
})

describe('SystemSampler (this machine)', () => {
  it('samples the machine and a real process tree', async () => {
    const s = new SystemSampler()
    await s.sample(null)
    await new Promise((r) => setTimeout(r, 250))
    const out = await s.sample(process.pid)
    expect(out.cpu.threads.length).toBeGreaterThan(0)
    expect(out.cpu.threads.every((x) => x >= 0 && x <= 100)).toBe(true)
    expect(out.memory.totalKb).toBeGreaterThan(out.memory.usedKb)
    expect(out.terminal?.pid).toBe(process.pid)
    expect(out.terminal!.processes).toBeGreaterThanOrEqual(1)
    expect(out.terminal!.rssKb).toBeGreaterThan(0)
  })
})
