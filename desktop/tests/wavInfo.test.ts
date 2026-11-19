import { describe, expect, it } from 'vitest'
import { mmss, wavDuration } from '../src/renderer/wavInfo'

function wav(samples: number, rate = 24000, extraChunk = false): ArrayBuffer {
  const data = samples * 2
  const extra = extraChunk ? 12 : 0
  const b = new Uint8Array(44 + extra + data)
  const v = new DataView(b.buffer)
  const put = (o: number, t: string) => b.set([...t].map((c) => c.charCodeAt(0)), o)
  put(0, 'RIFF'); v.setUint32(4, 36 + extra + data, true); put(8, 'WAVEfmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  let o = 36
  if (extraChunk) { put(o, 'LIST'); v.setUint32(o + 4, 4, true); o += 12 }
  put(o, 'data'); v.setUint32(o + 4, data, true)
  return b.buffer
}

describe('wavDuration', () => {
  it('reads the length from the header', () => {
    expect(wavDuration(wav(24000))).toBeCloseTo(1, 5)
    expect(wavDuration(wav(36000))).toBeCloseTo(1.5, 5)
  })
  it('skips extra chunks before the data and tolerates junk', () => {
    expect(wavDuration(wav(48000, 24000, true))).toBeCloseTo(2, 5)
    expect(wavDuration(new ArrayBuffer(10))).toBe(0)
    expect(wavDuration(new TextEncoder().encode('not a wav file, definitely not a wav file at all!!!').buffer)).toBe(0)
  })
})

describe('mmss', () => {
  it('formats seconds', () => {
    expect(mmss(0)).toBe('0:00'); expect(mmss(7.4)).toBe('0:07'); expect(mmss(75)).toBe('1:15'); expect(mmss(-3)).toBe('0:00')
  })
})
