import type { Chime } from './notify'
import notificationUrl from './assets/sounds/notification.mp3?url'
import recordingCueUrl from './assets/sounds/recording-cue.mp3?url'

/**
 * Notification and recording sounds. The two short clips are CC0 recordings from Freesound (see THIRD_PARTY.md). If a file cannot be
 * played, a synthesised blip is used instead so a notification is never lost.
 */
const clamp = (v: number) => Math.min(1, Math.max(0, v))

let ctx: AudioContext | null = null
function blip(freq: number, volume: number): void {
  try {
    ctx ??= new AudioContext()
    const c = ctx; const t = c.currentTime + 0.01
    const o = c.createOscillator(); const g = c.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, clamp(volume) * 0.3), t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.27)
  } catch { /* no audio device */ }
}

/** Plays a clip; resolves when it ends (or after `maxMs`). Falls back to a blip. */
function clip(url: string, volume: number, fallbackHz: number, maxMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url)
    a.volume = clamp(volume)
    const done = () => resolve()
    a.onended = done
    setTimeout(done, maxMs)
    a.play().catch(() => { blip(fallbackHz, volume); done() })
  })
}

/** `volume` 0-1. done = the notification once; attention = twice, so it is told apart from "done". */
export function playChime(kind: Chime, volume: number): void {
  void clip(notificationUrl, kind === 'done' ? volume * 0.85 : volume, kind === 'done' ? 880 : 988)
  if (kind === 'attention') setTimeout(() => void clip(notificationUrl, volume, 1175), 430)
}

/** The short cue for "recording started / stopped". Resolves when it has finished, so recording can begin after it and not capture it. */
export function playRecordingCue(volume: number): Promise<void> {
  return clip(recordingCueUrl, volume, 784, 700)
}
