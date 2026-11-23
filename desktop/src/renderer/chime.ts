import type { Chime } from './notify'
import { applyOutput } from './audioOutput'
import recordingCueUrl from './assets/sounds/recording-cue.mp3?url'
import doneUrl from './assets/sounds/done.mp3?url'

/**
 * "Done" and the recording cue are short CC0 clips (see THIRD_PARTY.md); "needs you" is synthesised (soft bell notes: a sine with a
 * quiet octave above, a short attack and a long decay). All of them follow the chosen output device.
 */
const clamp = (v: number) => Math.min(1, Math.max(0, v))

let ctx: AudioContext | null = null
function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    applyOutput(ctx)
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null } // no audio device
}

/** One bell-like note starting `at` seconds from now. */
function note(c: AudioContext, freq: number, at: number, length: number, volume: number): void {
  const t = c.currentTime + 0.02 + at
  const peak = Math.max(0.0002, clamp(volume) * 0.22)
  const out = c.createGain()
  out.gain.setValueAtTime(0.0001, t)
  out.gain.exponentialRampToValueAtTime(peak, t + 0.012)
  out.gain.exponentialRampToValueAtTime(0.0001, t + length)
  out.connect(c.destination)
  for (const [mult, level] of [[1, 1], [2, 0.18]] as const) {
    const o = c.createOscillator(); const g = c.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(freq * mult, t); g.gain.value = level
    o.connect(g).connect(out); o.start(t); o.stop(t + length + 0.02)
  }
}

const G5 = 783.99, C6 = 1046.5, E6 = 1318.51

/** Plays a short clip on the chosen output; resolves when it ends (or after `maxMs`). */
function clip(url: string, volume: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url)
    applyOutput(a)
    a.volume = clamp(volume)
    a.onended = () => resolve()
    setTimeout(resolve, maxMs)
    a.play().catch(() => resolve())
  })
}

/** `volume` 0-1. done = a water drop; attention = three soft notes rising, so it is told apart from "done". */
export function playChime(kind: Chime, volume: number): void {
  if (kind === 'done') { void clip(doneUrl, volume * 0.9, 1000); return }
  const c = context(); if (!c) return
  note(c, G5, 0, 0.5, volume); note(c, C6, 0.12, 0.5, volume); note(c, E6, 0.24, 0.9, volume)
}

/** The short cue for "recording started / stopped". Resolves when it has finished, so recording can begin after it and not capture it. */
export function playRecordingCue(volume: number): Promise<void> { return clip(recordingCueUrl, volume, 700) }
