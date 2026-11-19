import { createHash } from 'node:crypto'

export interface TrackedMessage { messageId: string; text: string }

const hash = (s: string) => createHash('sha1').update(s.trim()).digest('hex')

/** How long a completed message may wait for its turn's Stop before we call it progress. */
export const PROGRESS_GRACE_MS = 1000

/**
 * Classifies completed assistant messages within a turn, deterministically:
 *   - a message followed by another message or tool activity is a *progress* update;
 *   - the message the turn ends on (matched by Stop.last_assistant_message) is the *final* result;
 *   - a message that has waited PROGRESS_GRACE_MS without a Stop is progress (long-running tool).
 * Observed with real Claude Code: the hook for a message can start after the PreToolUse that
 * follows it, so tool activity alone is not enough and the grace timer is required.
 * The same text is never emitted twice (once as progress, once as final).
 */
export class TurnTracker {
  private candidate: (TrackedMessage & { at: number }) | null = null
  private emitted = new Map<string, string>() // text hash -> messageId already handled

  /** A new completed message arrives. Earlier candidate (if any) must have been progress. */
  onMessage(m: TrackedMessage, now = Date.now()): TrackedMessage | null {
    if (this.emitted.has(hash(m.text))) return null // late duplicate (e.g. arrived after Stop)
    const promoted = this.promote()
    this.candidate = { ...m, at: now }
    return promoted
  }

  /** Tool activity proves the candidate was an intermediate (progress) message. */
  onToolActivity(): TrackedMessage | null {
    return this.promote()
  }

  /** Called periodically: stale candidates become progress. */
  tick(now = Date.now(), graceMs = PROGRESS_GRACE_MS): TrackedMessage | null {
    return this.candidate && now - this.candidate.at >= graceMs ? this.promote() : null
  }

  /** Turn ends. `lastAssistantMessage` (from the Stop hook) wins over our candidate. */
  onTurnEnd(lastAssistantMessage: string | null): { final: TrackedMessage | null; alreadySpoken: boolean } {
    const cand = this.candidate
    this.candidate = null
    const text = (lastAssistantMessage ?? cand?.text ?? '').trim()
    if (!text) return { final: null, alreadySpoken: false }
    const h = hash(text)
    const prior = this.emitted.get(h)
    const id = prior ?? (cand && hash(cand.text) === h ? cand.messageId : `final:${h}`)
    this.remember(h, id)
    return { final: { messageId: id, text }, alreadySpoken: prior !== undefined }
  }

  reset(): void { this.candidate = null }

  private promote(): TrackedMessage | null {
    const c = this.candidate
    this.candidate = null
    if (!c) return null
    this.remember(hash(c.text), c.messageId)
    return { messageId: c.messageId, text: c.text }
  }

  private remember(h: string, id: string): void {
    this.emitted.set(h, id)
    if (this.emitted.size > 50) this.emitted.delete(this.emitted.keys().next().value as string)
  }
}
