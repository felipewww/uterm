import { randomUUID } from 'node:crypto'
import type { AnyAgentEvent } from '@shared/events'
import type { AppSettings, SessionRecord } from '@shared/types'
import { AudioQueue } from './audioQueue'
import { prepareSpeech } from './speechText'
import { PRIORITY, classifyEvent, effectiveMode, isForeground, modeAllows, type FocusContext } from './voicePolicy'

export interface VoiceDeps {
  getSession(id: string): SessionRecord | undefined
  isMuted(id: string): boolean
  settings(): AppSettings
  focus(): FocusContext
  synthesize(text: string, voiceId: string, signal: AbortSignal): Promise<Uint8Array>
  /** Plays in the renderer; resolves when playback ends (or is stopped). */
  play(audio: Uint8Array, speed: number, requestId: string): Promise<void>
  stopPlayback(): void
  onSpoken(sessionId: string, eventId: string, voiceId: string, priority: number, text: string): void
  onState(state: { speakingSessionId: string | null; queued: number }): void
  onError(message: string): void
}

/** Connects normalised events to the global audio queue through the deterministic VoicePolicy. */
export class VoiceCoordinator {
  readonly queue: AudioQueue
  private lastSpoken = new Map<string, string>()

  constructor(private d: VoiceDeps) {
    this.queue = new AudioQueue({
      maxItems: d.settings().queueMaxItems,
      synthesize: (t, v, s) => d.synthesize(t, v, s),
      play: (audio, req) => d.play(audio, this.speedFor(req.sessionId), req.id),
      stopPlayback: () => d.stopPlayback(),
      revalidate: (req) => this.revalidate(req.sessionId, req.kind, !!req.force),
      onChange: (s) => d.onState(s),
      onSpoken: (req, text) => { this.lastSpoken.set(req.sessionId, req.text); d.onSpoken(req.sessionId, req.eventId, req.voiceProfileId, req.priority, text) },
      onError: (_r, err) => d.onError(`Voice playback failed: ${err.message}`)
    })
  }

  private speedFor(sessionId: string): number {
    return this.d.getSession(sessionId)?.playbackSpeed ?? this.d.settings().defaultPlaybackSpeed
  }

  private voiceFor(s: SessionRecord): string { return s.voiceProfileId ?? this.d.settings().defaultVoiceId }

  private revalidate(sessionId: string, kind: Parameters<typeof modeAllows>[1], force: boolean): { speak: boolean; prefix?: string } {
    const s = this.d.getSession(sessionId)
    const settings = this.d.settings()
    if (settings.globalMute) return { speak: false }
    if (!s) return { speak: force } // voice previews have no session
    if (this.d.isMuted(sessionId)) return { speak: false }
    const fg = isForeground(sessionId, this.d.focus())
    const mode = effectiveMode(s, settings, fg)
    if (!force && !modeAllows(mode, kind)) return { speak: false }
    return { speak: true, prefix: fg ? undefined : `${s.title}.` }
  }

  onEvent(e: AnyAgentEvent): void {
    if (e.type === 'TURN_COMPLETED') this.queue.discardProgress(e.sessionId)
    const c = classifyEvent(e)
    if (!c) return
    const s = this.d.getSession(e.sessionId)
    if (!s) return
    if (!this.revalidate(e.sessionId, c.kind, false).speak) return
    const settings = this.d.settings()
    const text = c.kind === 'permission' ? c.text : prepareSpeech(c.text, { maxChars: settings.speechMaxChars })
    if (!text) return
    this.queue.enqueue({
      sessionId: e.sessionId, eventId: e.id, dedupeKey: c.dedupeKey, voiceProfileId: this.voiceFor(s),
      text, kind: c.kind, priority: PRIORITY[c.kind],
      ttlMs: c.kind === 'progress' ? settings.progressExpiryMs : c.kind === 'final' ? 10 * 60_000 : 30 * 60_000
    })
  }

  /** Selected session or window focus changed: queued audio is re-judged immediately. */
  focusChanged(): void { this.queue.reevaluate() }

  replay(sessionId: string): boolean {
    const s = this.d.getSession(sessionId)
    const text = this.lastSpoken.get(sessionId)
    if (!s || !text) return false
    this.queue.enqueue({
      sessionId, eventId: randomUUID(), dedupeKey: `replay:${randomUUID()}`, voiceProfileId: this.voiceFor(s),
      text, kind: 'final', priority: 1, ttlMs: 60_000, force: true
    })
    return true
  }

  /** Preview a voice (settings screen). */
  preview(voiceId: string, text: string, sessionId = 'preview'): void {
    this.queue.enqueue({
      sessionId, eventId: randomUUID(), dedupeKey: `preview:${randomUUID()}`, voiceProfileId: voiceId,
      text, kind: 'question', priority: 1, ttlMs: 60_000, force: true
    })
  }

  seedLastSpoken(sessionId: string, text: string): void { this.lastSpoken.set(sessionId, text) }
  hasReplay(sessionId: string): boolean { return this.lastSpoken.has(sessionId) }
}
