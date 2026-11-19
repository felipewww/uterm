import { reactive } from 'vue'
import { wavDuration } from '../wavInfo'

/**
 * The renderer owns playback. Main synthesises a message as a few WAV chunks and pushes them here as they are ready;
 * a Track gathers the chunks of one message so the Activity panel can show a time bar and let the user scrub across
 * the whole message, pause, and replay it from memory. Main's queue only waits for the message to finish (audio:ended).
 */
export interface Chunk { url: string; duration: number }
export type TrackStatus = 'buffering' | 'playing' | 'paused' | 'ended'
export interface Track {
  /** activity event id the audio belongs to */
  id: string
  requestId: string
  sessionId: string
  speed: number
  chunks: Chunk[]
  /** number of chunks the whole message will have */
  expected: number
  /** every chunk has arrived: duration is final and it can be replayed without the TTS service */
  complete: boolean
  status: TrackStatus
  /** seconds into the whole message */
  position: number
  /** main's queue is waiting for this track to end */
  owned: boolean
  createdAt: number
}

export const tracks = reactive<Record<string, Track>>({})
const MAX_TRACKS = 12
const PAUSE_RELEASE_MS = 60_000

let audio: HTMLAudioElement | null = null
let active: { id: string; index: number } | null = null
let raf = 0
let pauseTimer: number | undefined
const aborted = new Set<string>() // requestIds whose late chunks must be ignored

export const totalOf = (t: Track): number => t.chunks.reduce((n, c) => n + c.duration, 0)
const startOf = (t: Track, index: number): number => t.chunks.slice(0, index).reduce((n, c) => n + c.duration, 0)

function locate(t: Track, seconds: number): { index: number; offset: number } {
  let left = Math.max(0, seconds)
  for (let i = 0; i < t.chunks.length; i++) {
    const d = t.chunks[i]!.duration
    if (left < d || i === t.chunks.length - 1) return { index: i, offset: Math.min(left, Math.max(0, d - 0.05)) }
    left -= d
  }
  return { index: 0, offset: 0 }
}

function ensureAudio(): HTMLAudioElement {
  audio ??= new Audio()
  audio.preservesPitch = true
  return audio
}

function stopLoop(): void { if (raf) { cancelAnimationFrame(raf); raf = 0 } }
function startLoop(): void {
  stopLoop()
  const tick = () => {
    const t = active ? tracks[active.id] : undefined
    if (t && audio && t.status === 'playing') t.position = startOf(t, active!.index) + audio.currentTime
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

function releaseOwned(t: Track): void {
  if (!t.owned) return
  t.owned = false
  void window.echo.voice.audioEnded({ requestId: t.requestId })
}

function forgetPauseTimer(): void { if (pauseTimer !== undefined) { clearTimeout(pauseTimer); pauseTimer = undefined } }

function finish(t: Track): void {
  t.status = 'ended'; t.position = totalOf(t)
  active = null; stopLoop(); forgetPauseTimer()
  releaseOwned(t)
}

function onChunkEnded(t: Track): void {
  if (!active || active.id !== t.id) return
  const next = active.index + 1
  if (next < t.chunks.length) playChunk(t, next)
  else if (t.complete) finish(t)
  else { t.status = 'buffering'; t.position = totalOf(t); stopLoop() } // the voice is still generating the rest
}

/** Starts (or, with `paused`, just positions) playback at a chunk and an offset inside it. */
function playChunk(t: Track, index: number, offset = 0, paused = false): void {
  const el = ensureAudio()
  forgetPauseTimer()
  active = { id: t.id, index }
  el.onloadedmetadata = () => { if (offset > 0) el.currentTime = offset }
  el.onended = () => onChunkEnded(t)
  el.onerror = () => onChunkEnded(t) // a bad chunk is skipped
  el.src = t.chunks[index]!.url
  el.playbackRate = t.speed
  t.position = startOf(t, index) + offset
  if (paused) { el.pause(); t.status = 'paused'; stopLoop(); return }
  t.status = 'playing'
  el.play().catch(() => onChunkEnded(t))
  startLoop()
}

/** Pauses whatever is active (never touches main's queue, except to release it when it was waiting on that track). */
function pauseActive(): void {
  if (!active) return
  const t = tracks[active.id]
  audio?.pause(); stopLoop()
  if (t) { t.status = 'paused'; releaseOwned(t) }
  active = null; forgetPauseTimer()
}

function trim(): void {
  const ids = Object.keys(tracks)
  if (ids.length <= MAX_TRACKS) return
  for (const id of ids.sort((a, b) => tracks[a]!.createdAt - tracks[b]!.createdAt)) {
    if (Object.keys(tracks).length <= MAX_TRACKS) break
    if (active?.id === id) continue
    for (const c of tracks[id]!.chunks) URL.revokeObjectURL(c.url)
    delete tracks[id]
  }
}

function drop(id: string): void {
  const old = tracks[id]
  if (!old) return
  if (active?.id === id) { audio?.pause(); active = null; stopLoop() }
  for (const c of old.chunks) URL.revokeObjectURL(c.url)
  delete tracks[id]
}

function onChunk(m: { requestId: string; eventId: string; sessionId: string; index: number; total: number; speed: number; data: ArrayBuffer }): void {
  if (aborted.has(m.requestId)) return
  let t = tracks[m.eventId]
  if (m.index === 0 || !t || t.requestId !== m.requestId) {
    if (m.index !== 0) return // a late chunk of a message we no longer track
    pauseActive() // main starts a new message: any local replay gives way
    drop(m.eventId)
    t = tracks[m.eventId] = { id: m.eventId, requestId: m.requestId, sessionId: m.sessionId, speed: m.speed, chunks: [], expected: m.total, complete: false, status: 'buffering', position: 0, owned: true, createdAt: Date.now() }
    trim()
  }
  const duration = wavDuration(m.data)
  t.chunks.push({ url: URL.createObjectURL(new Blob([m.data], { type: 'audio/wav' })), duration })
  t.expected = m.total
  t.complete = t.chunks.length >= m.total
  if (m.index === 0) playChunk(t, 0)
  else if (active?.id === t.id && t.status === 'buffering') playChunk(t, t.chunks.length - 1)
  else if (active?.id === t.id && t.complete && t.status === 'playing') { /* keeps playing; end is detected on the last chunk */ }
}

/** Main cancelled what it was speaking (stop button, mute, session closed…). */
function onStop(): void {
  if (!active) return
  const t = tracks[active.id]
  if (!t?.owned) return // a replay the user started is theirs to stop
  aborted.add(t.requestId)
  pauseActive()
}

/** Wires main's audio events to the player. */
export function installAudioPlayer(): () => void {
  const offChunk = window.echo.events.onAudioChunk(onChunk)
  const offStop = window.echo.events.onAudioStop(onStop)
  return () => { offChunk(); offStop(); pauseActive(); for (const id of Object.keys(tracks)) drop(id) }
}

/** Frees the speaker for a replay: stops what main is speaking, pauses any other replay. */
async function takeSpeaker(t: Track): Promise<void> {
  if (active && active.id !== t.id) {
    const owned = tracks[active.id]?.owned
    if (owned) await window.echo.voice.stopPlayback()
    else pauseActive()
  }
}

export async function togglePlay(id: string): Promise<void> {
  const t = tracks[id]
  if (!t || !t.chunks.length) return
  if (active?.id === id) {
    if (t.status === 'playing') {
      audio?.pause(); stopLoop(); t.status = 'paused'
      if (t.owned) { forgetPauseTimer(); pauseTimer = window.setTimeout(() => { releaseOwned(t); pauseTimer = undefined }, PAUSE_RELEASE_MS) } // don't hold the voice queue forever
    } else if (t.status === 'paused') {
      forgetPauseTimer(); t.status = 'playing'
      void audio?.play().catch(() => onChunkEnded(t)); startLoop()
    }
    return
  }
  await takeSpeaker(t)
  const from = t.status === 'ended' || t.position >= totalOf(t) - 0.05 ? 0 : t.position
  const { index, offset } = locate(t, from)
  playChunk(t, index, offset)
}

/** Jumps to a time inside the message. Keeps paused/playing as it was; an idle track is positioned and left paused. */
export async function seekTo(id: string, seconds: number): Promise<void> {
  const t = tracks[id]
  if (!t || !t.chunks.length) return
  const { index, offset } = locate(t, Math.min(seconds, totalOf(t)))
  if (active?.id === id) { playChunk(t, index, offset, t.status === 'paused'); return }
  await takeSpeaker(t)
  playChunk(t, index, offset, true)
}

/** Skips `by` seconds (negative = back). */
export async function skip(id: string, by: number): Promise<void> {
  const t = tracks[id]
  if (t) await seekTo(id, Math.max(0, Math.min(totalOf(t), t.position + by)))
}
