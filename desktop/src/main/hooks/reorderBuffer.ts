interface Held<T> { item: T; arrivedAt: number; order: number }

/**
 * Hook scripts run as separate async processes, so events reach us out of order
 * (observed with real Claude Code: PreToolUse before the MessageDisplay that
 * preceded it, Stop before the final MessageDisplay). Each envelope carries a
 * monotonic start timestamp; we hold events for a short window and release them
 * sorted by it.
 */
export class ReorderBuffer<T extends { seq?: number }> {
  private held: Held<T>[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private counter = 0

  constructor(
    private windowMs: number,
    private release: (items: T[]) => void,
    private now: () => number = Date.now
  ) {}

  push(item: T): void {
    this.held.push({ item, arrivedAt: this.now(), order: this.counter++ })
    this.schedule()
  }

  /** Release everything older than the window (or everything when `all`). */
  flush(all = false): void {
    const cutoff = this.now() - this.windowMs
    const ready = this.held.filter((h) => all || h.arrivedAt <= cutoff)
    if (ready.length) {
      this.held = this.held.filter((h) => !ready.includes(h))
      ready.sort((a, b) => (a.item.seq ?? Infinity) - (b.item.seq ?? Infinity) || a.order - b.order)
      this.release(ready.map((h) => h.item))
    }
    this.timer = undefined
    if (this.held.length) this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), this.windowMs)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  get size(): number { return this.held.length }
}
