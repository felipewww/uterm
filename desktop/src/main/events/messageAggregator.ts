export interface MessageFragment {
  messageId: string
  index: number
  final: boolean
  delta: string
}

interface Buffer {
  parts: Map<number, string>
  finalIndex: number | null
  done: boolean
  touched: number
}

/**
 * Reassembles streamed message deltas. Tolerates out-of-order delivery
 * (async hooks are separate processes), duplicate batches and the empty
 * final fragment Claude emits when a message ends on a newline.
 */
export class MessageAggregator {
  private buffers = new Map<string, Buffer>()
  private completedIds = new Set<string>()

  /** Returns the full message text once every fragment 0..final has arrived. */
  ingest(f: MessageFragment, now = Date.now()): string | null {
    if (this.completedIds.has(f.messageId)) return null // duplicate of a finished message
    let b = this.buffers.get(f.messageId)
    if (!b) {
      b = { parts: new Map(), finalIndex: null, done: false, touched: now }
      this.buffers.set(f.messageId, b)
    }
    b.touched = now
    if (!b.parts.has(f.index)) b.parts.set(f.index, f.delta) // first write wins: dedupe
    if (f.final) b.finalIndex = f.index
    return this.tryComplete(f.messageId, b)
  }

  /** Completes messages whose final fragment arrived but with gaps after `maxAgeMs`. */
  flushStale(maxAgeMs: number, now = Date.now()): Array<{ messageId: string; text: string }> {
    const out: Array<{ messageId: string; text: string }> = []
    for (const [id, b] of this.buffers) {
      if (now - b.touched < maxAgeMs) continue
      if (b.finalIndex !== null) out.push({ messageId: id, text: this.join(b) })
      this.buffers.delete(id)
      if (b.finalIndex !== null) this.markCompleted(id)
    }
    return out
  }

  private tryComplete(id: string, b: Buffer): string | null {
    if (b.finalIndex === null) return null
    for (let i = 0; i <= b.finalIndex; i++) if (!b.parts.has(i)) return null
    const text = this.join(b)
    this.buffers.delete(id)
    this.markCompleted(id)
    return text
  }

  private join(b: Buffer): string {
    return [...b.parts.entries()].sort((a, c) => a[0] - c[0]).map(([, t]) => t).join('')
  }

  private markCompleted(id: string): void {
    this.completedIds.add(id)
    if (this.completedIds.size > 500) this.completedIds.delete(this.completedIds.values().next().value as string)
  }
}
