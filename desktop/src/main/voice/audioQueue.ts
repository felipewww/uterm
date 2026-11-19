import { randomUUID } from 'node:crypto'
import type { AudioState, SpeechKind } from '@shared/types'
import { splitSentences } from './speechText'
import { appendSilence, pauseAfter } from './wav'

export interface AudioRequest {
  id: string
  sessionId: string
  eventId: string
  dedupeKey: string
  voiceProfileId: string
  text: string
  kind: SpeechKind
  priority: 1 | 2 | 3
  createdAt: number
  expiresAt: number
  cancelled: boolean
  requeued?: boolean
  /** Explicit user action (listen): bypasses the communication mode and per-session mute, not mute-all. */
  force?: boolean
}

export interface QueueDeps {
  /** Synthesises one chunk. Must honour `signal` where possible. */
  synthesize(text: string, voiceProfileId: string, signal: AbortSignal): Promise<Uint8Array>
  /** Plays one chunk; resolves when finished or when stopPlayback() was called. */
  play(audio: Uint8Array, req: AudioRequest): Promise<void>
  stopPlayback(): void
  /** Re-evaluates the voice policy right before synthesis/playback. */
  revalidate(req: AudioRequest): { speak: boolean; prefix?: string }
  onChange?(state: AudioState): void
  onSpoken?(req: AudioRequest, spokenText: string): void
  onError?(req: AudioRequest, err: Error): void
  now?(): number
  maxItems: number
}

export type NewAudioRequest = Pick<AudioRequest, 'sessionId' | 'eventId' | 'dedupeKey' | 'voiceProfileId' | 'text' | 'kind' | 'priority'> &
  { ttlMs: number; force?: boolean }

/**
 * Single global queue: only one session speaks at a time. Priority order is
 * questions/permissions/blockers (1) > finals (2) > progress (3).
 */
export class AudioQueue {
  private queue: AudioRequest[] = []
  private current: { req: AudioRequest; abort: AbortController } | null = null
  private seen: string[] = []
  private pumping = false
  private paused = false
  private phase: AudioState['phase'] = 'idle'
  private since = 0

  constructor(private deps: QueueDeps) {}

  private now(): number { return this.deps.now ? this.deps.now() : Date.now() }

  get queuedCount(): number { return this.queue.length }
  get speakingSessionId(): string | null { return this.current?.req.sessionId ?? null }
  get speakingRequest(): AudioRequest | null { return this.current?.req ?? null }
  get speakingEventId(): string | null { return this.current?.req.eventId ?? null }

  enqueue(n: NewAudioRequest): AudioRequest | null {
    if (this.seen.includes(n.dedupeKey)) return null // never play the same content twice
    const req: AudioRequest = {
      id: randomUUID(), sessionId: n.sessionId, eventId: n.eventId, dedupeKey: n.dedupeKey,
      voiceProfileId: n.voiceProfileId, text: n.text, kind: n.kind, priority: n.priority,
      createdAt: this.now(), expiresAt: this.now() + n.ttlMs, cancelled: false, force: n.force
    }
    this.markSeen(n.dedupeKey)
    this.queue.push(req)
    this.sort()
    this.enforceLimit()
    if (!this.queue.includes(req)) return null // dropped by the limit
    if (this.current && req.priority < this.current.req.priority) this.interruptCurrent()
    this.emit()
    void this.pump()
    return req
  }

  /** Drop everything queued for a session (and stop it if it is speaking). */
  cancelSession(sessionId: string): void {
    this.queue = this.queue.filter((r) => { if (r.sessionId === sessionId) r.cancelled = true; return r.sessionId !== sessionId })
    if (this.current?.req.sessionId === sessionId) this.interruptCurrent(true)
    this.emit()
  }

  cancelAll(): void {
    for (const r of this.queue) r.cancelled = true
    this.queue = []
    if (this.current) this.interruptCurrent(true)
    this.emit()
  }

  /** Hold new playback (e.g. while the microphone is recording) and silence the current one. */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused && this.current) this.interruptCurrent(true)
    if (!paused) void this.pump()
    this.emit()
  }

  /** Stop what is playing now, keep the queue. */
  skipCurrent(): void {
    if (this.current) this.interruptCurrent(true)
  }

  /** Agent finished its turn: queued progress for it is now stale. */
  discardProgress(sessionId: string): void {
    this.queue = this.queue.filter((r) => !(r.sessionId === sessionId && r.kind === 'progress'))
    this.emit()
  }

  /** Re-run policy over queued items (e.g. selected session changed). */
  reevaluate(): void {
    this.queue = this.queue.filter((r) => this.deps.revalidate(r).speak)
    if (this.current && !this.deps.revalidate(this.current.req).speak) this.interruptCurrent(true)
    this.emit()
  }

  private interruptCurrent(dropIt = false): void {
    if (!this.current) return
    const { req, abort } = this.current
    abort.abort()
    req.cancelled = true
    this.deps.stopPlayback()
    // A final result cut off by something more urgent is worth hearing afterwards, once.
    if (!dropIt && req.kind === 'final' && !req.requeued) {
      this.queue.push({ ...req, id: randomUUID(), cancelled: false, requeued: true })
      this.sort()
    }
  }

  private markSeen(key: string): void {
    this.seen.push(key)
    if (this.seen.length > 300) this.seen.shift()
  }

  private sort(): void {
    this.queue.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)
  }

  private enforceLimit(): void {
    while (this.queue.length > this.deps.maxItems) {
      // Drop the least valuable: lowest priority (highest number), then oldest.
      let worst = 0
      this.queue.forEach((r, i) => {
        const w = this.queue[worst]!
        if (r.priority > w.priority || (r.priority === w.priority && r.createdAt < w.createdAt)) worst = i
      })
      this.queue.splice(worst, 1)
    }
  }

  private emit(): void {
    this.deps.onChange?.({
      speakingSessionId: this.speakingSessionId, speakingEventId: this.speakingEventId, queued: this.queue.length,
      phase: this.current ? this.phase : 'idle', since: this.since, queuedEventIds: this.queue.map((r) => r.eventId)
    })
  }

  private setPhase(p: AudioState['phase']): void {
    if (this.phase === p) return
    this.phase = p; this.since = this.now()
    this.emit()
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length > 0 && !this.paused) {
        const req = this.queue.shift()!
        if (req.cancelled) continue
        if (this.now() > req.expiresAt) continue // expired
        const verdict = this.deps.revalidate(req)
        if (!verdict.speak) continue
        await this.speak(req, verdict.prefix)
      }
    } finally {
      this.pumping = false
      this.emit()
    }
  }

  private async speak(req: AudioRequest, prefix?: string): Promise<void> {
    const abort = new AbortController()
    this.current = { req, abort }
    this.phase = 'generating'; this.since = this.now()
    this.emit()
    const fullText = prefix ? `${prefix} ${req.text}` : req.text
    const chunks = splitSentences(fullText)
    try {
      let next: Promise<Uint8Array> | null = chunks[0] ? this.deps.synthesize(chunks[0], req.voiceProfileId, abort.signal) : null
      // Prevent unhandled rejection noise if we abort while a later chunk is in flight.
      next?.catch(() => undefined)
      for (let i = 0; i < chunks.length; i++) {
        this.setPhase('generating') // waiting for synthesis (first chunk, or the voice fell behind playback)
        const audio = await next!
        if (req.cancelled) return // ignore results of cancelled synthesis
        next = i + 1 < chunks.length ? this.deps.synthesize(chunks[i + 1]!, req.voiceProfileId, abort.signal) : null
        next?.catch(() => undefined)
        const again = this.deps.revalidate(req)
        if (!again.speak) { this.deps.stopPlayback(); return }
        this.setPhase('playing')
        const last = i === chunks.length - 1
        await this.deps.play(last ? audio : appendSilence(audio, pauseAfter(chunks[i]!)), req)
        if (req.cancelled) return
      }
      this.deps.onSpoken?.(req, fullText)
    } catch (err) {
      if (!req.cancelled) this.deps.onError?.(req, err as Error)
    } finally {
      this.current = null
    }
  }
}
