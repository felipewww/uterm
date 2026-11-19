import { reactive } from 'vue'
import { coachOnFor } from '@shared/types'
import { notify, store } from '../store'

export interface Draft {
  status: 'recording' | 'transcribing' | 'review' | 'error'
  seconds: number
  text: string
  error: string
  note: string
  /** the transcription as it came back, so "Back to mine" can restore it */
  original?: string
  /** the more natural English version (B2–C1) shown next to the transcription before sending */
  coach?: { status: 'loading' | 'done' | 'error'; text: string; error: string }
}

/** The coach runs for a chat when its own choice (or, failing that, the global one) is on and an OpenAI key is present. */
export const coachEnabled = (sessionId: string): boolean => coachOnFor(store.settings.englishCoach, store.sessions.find((x) => x.id === sessionId)?.englishCoach) && store.keys.openai

/** Drafts are keyed by the session that was selected when recording STARTED. */
export const drafts = reactive<Record<string, Draft>>({})
export const recorder = reactive({ activeSessionId: null as string | null })

let media: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let timer: number | undefined
let started = 0
let cancelled = false

export const isRecording = (): boolean => recorder.activeSessionId !== null

export async function startRecording(sessionId: string): Promise<void> {
  if (isRecording()) return
  try {
    const mic = store.settings.microphoneId
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: mic ? { exact: mic } : undefined, echoCancellation: true, noiseSuppression: true, channelCount: 1 }
    })
  } catch (err) {
    drafts[sessionId] = { status: 'error', seconds: 0, text: '', error: `Microphone unavailable: ${(err as Error).message}`, note: '' }
    return
  }
  await window.echo.voice.recording({ recording: true }) // main stops synthesized audio to avoid feedback
  cancelled = false; chunks = []; started = Date.now()
  recorder.activeSessionId = sessionId
  drafts[sessionId] = { status: 'recording', seconds: 0, text: '', error: '', note: '' }
  media = new MediaRecorder(stream)
  media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  media.onstop = () => { void finish(sessionId) }
  media.start(250)
  timer = window.setInterval(() => { const d = drafts[sessionId]; if (d?.status === 'recording') d.seconds = Math.floor((Date.now() - started) / 1000) }, 250)
}

export function stopRecording(): void { if (media && media.state !== 'inactive') media.stop() }

export function cancelRecording(): void {
  cancelled = true
  const id = recorder.activeSessionId
  if (media && media.state !== 'inactive') media.stop()
  if (id) delete drafts[id]
}

export function discardDraft(sessionId: string): void { delete drafts[sessionId] }

function cleanup(): void {
  clearInterval(timer)
  stream?.getTracks().forEach((t) => t.stop())
  stream = null; media = null; chunks = []
  recorder.activeSessionId = null
  void window.echo.voice.recording({ recording: false })
}

async function finish(sessionId: string): Promise<void> {
  const blob = new Blob(chunks, { type: media?.mimeType || 'audio/webm' })
  cleanup() // recordings are held in memory only and dropped here
  if (cancelled) return
  const d = drafts[sessionId]
  if (!d) return
  if (blob.size < 2000) { drafts[sessionId] = { ...d, status: 'error', error: 'Recording was too short.' }; return }
  d.status = 'transcribing'
  try {
    const wav = await toWav16k(blob)
    const text: string = await window.echo.voice.transcribe(wav)
    if (!text) { drafts[sessionId] = { ...d, status: 'error', error: 'No speech detected.' }; return }
    drafts[sessionId] = { status: 'review', seconds: d.seconds, text, error: '', note: '', original: text }
    void runCoach(sessionId)
  } catch (err) {
    drafts[sessionId] = { ...d, status: 'error', error: `Transcription failed: ${(err as Error).message}. Is the STT service running?` }
  }
}

/** Asks the English coach for a more natural version of the draft's current text. Display only: nothing is sent anywhere else. */
export async function runCoach(sessionId: string): Promise<void> {
  const d = drafts[sessionId]
  if (!d || d.status !== 'review' || !d.text.trim() || !coachEnabled(sessionId)) return
  d.coach = { status: 'loading', text: '', error: '' }
  try {
    const text: string = await window.echo.coach.improve({ text: d.text })
    const now = drafts[sessionId]
    if (now?.coach) now.coach = { status: 'done', text, error: '' } // the draft may have been discarded or re-recorded meanwhile
  } catch (err) {
    const now = drafts[sessionId]
    if (now?.coach) now.coach = { status: 'error', text: '', error: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
  }
}
export function useNatural(sessionId: string): void { const d = drafts[sessionId]; if (d?.coach?.status === 'done') d.text = d.coach.text }
export function useMine(sessionId: string): void { const d = drafts[sessionId]; if (d?.original) d.text = d.original }

/** Sends the draft to the session it was recorded for, never the currently selected one. */
export async function submitDraft(sessionId: string, auto: boolean, force = false): Promise<void> {
  const d = drafts[sessionId]
  if (!d || !d.text.trim()) return
  const res: { sent: boolean; reason?: string } = await window.echo.voice.send({ id: sessionId, text: d.text.trim(), auto, force })
  if (res.sent) { delete drafts[sessionId]; return }
  d.status = 'review'
  d.note = res.reason === 'prompt-active'
    ? 'The agent is waiting at a prompt. Answer it in the terminal, or press Send again to send anyway.'
    : res.reason === 'not-idle' ? 'Agent is busy; kept for review.'
    : 'Session is not running; kept for review.'
  if (res.reason === 'prompt-active' && !auto) d.note += ' '
  if (!auto && res.reason === 'prompt-active') notify('info', d.note)
}

/** Decode (webm/opus) -> mono 16 kHz PCM -> WAV, so whisper.cpp needs no ffmpeg. */
async function toWav16k(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext()
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
  await ctx.close()
  const length = Math.ceil(decoded.duration * 16000)
  const off = new OfflineAudioContext(1, length, 16000)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return encodeWav(rendered.getChannelData(0), 16000)
}

function encodeWav(samples: Float32Array, rate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  w(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buf
}

export { toWav16k }
