import { StringDecoder } from 'node:string_decoder'

export interface PtyProcess {
  readonly pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (code: number, signal: number | undefined) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

export interface SpawnSpec {
  file: string
  args: string[]
  cwd: string
  env: Record<string, string>
  cols: number
  rows: number
}

export type PtyFactory = (spec: SpawnSpec) => PtyProcess

interface Entry { proc: PtyProcess; scrollback: string; exited: boolean }

const SCROLLBACK_CAP = 512 * 1024

/**
 * Owns native PTY processes, keyed by internal session id. Knows nothing about
 * agents, events or audio: it only moves bytes and manages process lifetime.
 */
export class PtyManager {
  private entries = new Map<string, Entry>()

  constructor(
    private factory: PtyFactory,
    private hooks: {
      onData: (id: string, data: string) => void
      onExit: (id: string, code: number) => void
    }
  ) {}

  has(id: string): boolean { return this.entries.has(id) && !this.entries.get(id)!.exited }

  spawn(id: string, spec: SpawnSpec): number {
    if (this.has(id)) throw new Error('session already running')
    const proc = this.factory(spec) // spawn failures propagate to the caller
    const entry: Entry = { proc, scrollback: '', exited: false }
    this.entries.set(id, entry)
    const decoder = new StringDecoder('utf8')
    proc.onData((chunk) => {
      const data = typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk as never))
      entry.scrollback = (entry.scrollback + data).slice(-SCROLLBACK_CAP)
      this.hooks.onData(id, data)
    })
    proc.onExit((code) => {
      entry.exited = true
      this.hooks.onExit(id, code)
    })
    return proc.pid
  }

  write(id: string, data: string): boolean {
    const e = this.entries.get(id)
    if (!e || e.exited) return false
    e.proc.write(data)
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.entries.get(id)
    if (!e || e.exited || cols < 2 || rows < 2) return
    try { e.proc.resize(cols, rows) } catch { /* process may be exiting */ }
  }

  scrollback(id: string): string { return this.entries.get(id)?.scrollback ?? '' }

  /** Graceful stop: SIGHUP (what a closed terminal sends), then SIGKILL if it lingers. */
  async kill(id: string, graceMs = 3000): Promise<void> {
    const e = this.entries.get(id)
    if (!e || e.exited) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { try { e.proc.kill('SIGKILL') } catch { /* gone */ } }, graceMs)
      const poll = setInterval(() => {
        if (e.exited) { clearTimeout(timer); clearInterval(poll); resolve() }
      }, 25)
      try { e.proc.kill('SIGHUP') } catch { e.exited = true }
    })
  }

  async killAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.kill(id)))
  }

  forget(id: string): void {
    if (!this.has(id)) this.entries.delete(id)
  }
}
