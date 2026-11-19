import { closeSync, openSync, readSync, statSync } from 'node:fs'

/**
 * Read-only incremental reader for an append-only JSONL file.
 * Polling (not fs.watch) because it behaves the same on every filesystem.
 */
export class TranscriptTail {
  private offset: number
  private carry = ''
  private timer: NodeJS.Timeout | undefined

  constructor(
    private path: string,
    private onLine: (line: string) => void,
    opts: { fromEnd: boolean; intervalMs?: number } = { fromEnd: false }
  ) {
    this.offset = opts.fromEnd ? safeSize(path) : 0
    this.intervalMs = opts.intervalMs ?? 300
  }
  private intervalMs: number

  start(): void {
    if (this.timer) return
    this.poll()
    this.timer = setInterval(() => this.poll(), this.intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Exposed for tests. */
  poll(): void {
    let size: number
    try { size = statSync(this.path).size } catch { return }
    if (size < this.offset) { this.offset = 0; this.carry = '' } // truncated/rotated
    if (size === this.offset) return
    const fd = openSync(this.path, 'r')
    try {
      while (this.offset < size) {
        const len = Math.min(256 * 1024, size - this.offset)
        const buf = Buffer.alloc(len)
        const n = readSync(fd, buf, 0, len, this.offset)
        if (n <= 0) break
        this.offset += n
        this.carry += buf.toString('utf8', 0, n)
        let nl: number
        while ((nl = this.carry.indexOf('\n')) >= 0) {
          const line = this.carry.slice(0, nl)
          this.carry = this.carry.slice(nl + 1)
          if (line.trim()) this.onLine(line)
        }
      }
    } finally { closeSync(fd) }
  }
}

function safeSize(p: string): number {
  try { return statSync(p).size } catch { return 0 }
}
