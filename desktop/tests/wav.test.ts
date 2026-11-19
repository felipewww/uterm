import { describe, expect, it } from 'vitest'
import { appendSilence, pauseAfter } from '../src/main/voice/wav'

function wav(samples: number, rate = 24000): Uint8Array {
  const data = samples * 2
  const b = new Uint8Array(44 + data)
  const v = new DataView(b.buffer)
  b.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0); v.setUint32(4, 36 + data, true)
  b.set([...'WAVEfmt '].map((c) => c.charCodeAt(0)), 8); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  b.set([...'data'].map((c) => c.charCodeAt(0)), 36); v.setUint32(40, data, true)
  b.fill(7, 44) // non-zero "audio"
  return b
}

describe('appendSilence', () => {
  it('adds the requested duration and fixes the header sizes', () => {
    const out = appendSilence(wav(2400), 250) // 0.1 s + 0.25 s at 24 kHz
    const v = new DataView(out.buffer)
    expect(out.length).toBe(44 + (2400 + 6000) * 2)
    expect(v.getUint32(4, true)).toBe(out.length - 8)
    expect(v.getUint32(40, true)).toBe((2400 + 6000) * 2)
    expect(out[44]).toBe(7) // original audio untouched
    expect(out[out.length - 1]).toBe(0) // silence appended
  })
  it('leaves anything that is not a plain PCM WAV alone', () => {
    const junk = new TextEncoder().encode('not a wav file at all, just some text bytes here....')
    expect(appendSilence(junk, 300)).toBe(junk)
    expect(appendSilence(wav(10), 0).length).toBe(44 + 20)
  })
})

describe('pauseAfter', () => {
  it('pauses longer after sentences than after commas', () => {
    expect(pauseAfter('That worked.')).toBeGreaterThan(pauseAfter('Well,'))
    expect(pauseAfter('Really?')).toBeGreaterThanOrEqual(pauseAfter('Done.'))
    expect(pauseAfter('no punctuation')).toBeGreaterThan(0)
  })
})
