import { randomUUID } from 'node:crypto'
import type { AnyAgentEvent } from '@shared/events'
import type { AppSettings, AudioState, SessionRecord } from '@shared/types'
import { AudioQueue } from './audioQueue'
import { prepareSpeech } from './speechText'
import { PRIORITY, classifyEvent, effectiveMode, isForeground, modeAllows, type FocusContext } from './voicePolicy'

export interface VoiceDeps {
  getSession(id: string): SessionRecord | undefined
  isMuted(id: string): boolean
  settings(): AppSettings
  focus(): FocusContext
  /** false when the user turned text-to-speech off: nothing is queued or synthesised, and no error is raised. */
  ttsEnabled(voiceId: string): boolean
  /** extra cache-key part identifying provider, model and style (cloud audio is not interchangeable with local audio) */
  voiceKey?(voiceId: string): string
  synthesize(text: string, voiceId: string, signal: AbortSignal): Promise<Uint8Array>
  /** Sends one chunk of a message to the renderer's player (which owns playback and seeking). */
  deliver(chunk: { audio: Uint8Array; requestId: string; eventId: string; sessionId: string; index: number; total: number; speed: number }): void
  /** Resolves when the renderer has finished playing the whole message, or playback was stopped. */
  finish(requestId: string): Promise<void>
  stopPlayback(): void
  onSpoken(sessionId: string, eventId: string, voiceId: string, priority: number, text: string): void
  onState(state: AudioState): void
  onError(message: string): void
}

/** Connects normalised events to the global audio queue through the deterministic VoicePolicy. */
export class VoiceCoordinator {
  readonly queue: AudioQueue
  /** Recently synthesized chunks (in memory only), so listening again to a message is instant. */
  private audioCache = new Map<string, Uint8Array>()
  private static readonly CACHE_MAX = 80

  constructor(private d: VoiceDeps) {
    this.queue = new AudioQueue({
      maxItems: d.settings().queueMaxItems,
      gapMs: 800,
      synthesize: (t, v, s) => this.synthesizeCached(t, v, s),
      play: (audio, req, meta) => d.deliver({ audio, requestId: req.id, eventId: req.eventId, sessionId: req.sessionId, index: meta.index, total: meta.total, speed: this.speedFor(req.sessionId) }),
      finish: (req) => d.finish(req.id),
      stopPlayback: () => d.stopPlayback(),
      revalidate: (req) => this.revalidate(req.sessionId, req.kind, !!req.force),
      onChange: (s) => d.onState(s),
      onSpoken: (req, text) => { if (!req.dedupeKey.startsWith('listen:')) d.onSpoken(req.sessionId, req.eventId, req.voiceProfileId, req.priority, text) },
      onError: (_r, err) => d.onError(`Voice playback failed: ${err.message}`)
    })
  }

  private async synthesizeCached(text: string, voiceId: string, signal: AbortSignal): Promise<Uint8Array> {
    const key = `${this.d.voiceKey?.(voiceId) ?? ''}\u0000${voiceId}\u0000${text}`
    const hit = this.audioCache.get(key)
    if (hit) { this.audioCache.delete(key); this.audioCache.set(key, hit); return hit } // refresh LRU position
    const audio = await this.d.synthesize(text, voiceId, signal)
    this.audioCache.set(key, audio)
    while (this.audioCache.size > VoiceCoordinator.CACHE_MAX) this.audioCache.delete(this.audioCache.keys().next().value as string)
    return audio
  }

  private speedFor(sessionId: string): number {
    return this.d.getSession(sessionId)?.playbackSpeed ?? this.d.settings().defaultPlaybackSpeed
  }

  // 'default' is what older sessions stored for "no voice of its own": it follows the voice chosen in Settings
  private voiceFor(s: SessionRecord): string { return s.voiceProfileId && s.voiceProfileId !== 'default' ? s.voiceProfileId : this.d.settings().defaultVoiceId }

  private revalidate(sessionId: string, kind: Parameters<typeof modeAllows>[1], force: boolean): { speak: boolean; prefix?: string } {
    const s = this.d.getSession(sessionId)
    const settings = this.d.settings()
    if (settings.globalMute) return { speak: false }
    if (!s) return { speak: force } // voice previews have no session
    if (!force && this.d.isMuted(sessionId)) return { speak: false } // an explicit "listen" works on a muted session
    const fg = isForeground(sessionId, this.d.focus())
    const mode = effectiveMode(s, settings, fg)
    if (!force && !modeAllows(mode, kind)) return { speak: false }
    return { speak: true, prefix: fg || force ? undefined : `${s.title}.` }
  }

  onEvent(e: AnyAgentEvent): void {
    if (e.type === 'TURN_COMPLETED') this.queue.discardProgress(e.sessionId)
    const c = classifyEvent(e)
    if (!c) return
    const s = this.d.getSession(e.sessionId)
    if (!s) return
    if (!this.d.ttsEnabled(this.voiceFor(s))) return // this chat's voice is unavailable (service turned off, or no cloud key): stay silent, no error
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

  /**
   * The user pressed "listen" on an activity message: speak it again (same speech preparation as live speech).
   * `ref` is the activity item id, so the UI can show which message is playing. Not recorded as a new spoken message.
   */
  listen(sessionId: string, text: string, ref: string): boolean {
    const s = this.d.getSession(sessionId)
    const spoken = prepareSpeech(text, { maxChars: this.d.settings().speechMaxChars })
    if (!s || !spoken || !this.d.ttsEnabled(this.voiceFor(s))) return false
    this.queue.enqueue({
      sessionId, eventId: ref, dedupeKey: `listen:${randomUUID()}`, voiceProfileId: this.voiceFor(s),
      text: spoken, kind: 'final', priority: 1, ttlMs: 60_000, force: true
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
}
