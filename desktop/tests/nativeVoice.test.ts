import { describe, expect, it } from 'vitest'
import { NativeStt } from '../src/main/voice/nativeStt'
import { SystemTts } from '../src/main/voice/systemTts'
import { wavToMonoFloat } from '../src/main/voice/wavRead'

function wav(samples: number[], rate: number, channels = 1): Uint8Array {
  const b = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(b)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, samples.length * 2, true)
  samples.forEach((s, i) => v.setInt16(44 + i * 2, s, true))
  return new Uint8Array(b)
}

describe('wav reader', () => {
  it('reads 16 kHz mono as is, mixes stereo down, resamples, and rejects junk', () => {
    expect(Array.from(wavToMonoFloat(wav([16384, -16384], 16000))).map((x) => +x.toFixed(2))).toEqual([0.5, -0.5])
    expect(Array.from(wavToMonoFloat(wav([32767, 0, 0, 32767], 16000, 2))).map((x) => +x.toFixed(2))).toEqual([0.5, 0.5])
    expect(wavToMonoFloat(wav(new Array(480).fill(1000), 48000)).length).toBe(160) // 48 kHz -> 16 kHz
    expect(() => wavToMonoFloat(new Uint8Array(10))).toThrow('Not a WAV')
  })
})

describe('built-in speech to text', () => {
  it('loads once, ignores clips shorter than 0.1 s, and cleans whisper markers', async () => {
    let loads = 0
    const stt = new NativeStt('/tmp/none', 'm', async () => { loads++; return async () => ({ text: ' Hello [BLANK_AUDIO] world ' }) })
    expect(await stt.transcribe(wav(new Array(800).fill(0), 16000))).toBe('') // too short, model not even loaded
    expect(loads).toBe(0)
    expect(await stt.transcribe(wav(new Array(16000).fill(500), 16000))).toBe('Hello world')
    await stt.transcribe(wav(new Array(16000).fill(500), 16000))
    expect(loads).toBe(1)
  })
  it('reports a model that cannot load, then tries again next time', async () => {
    let n = 0
    const stt = new NativeStt('/tmp/none', 'm', async () => { if (n++ === 0) throw new Error('offline'); return async () => ({ text: 'ok' }) })
    const clip = wav(new Array(16000).fill(500), 16000)
    await expect(stt.transcribe(clip)).rejects.toThrow('could not start: offline')
    expect(await stt.transcribe(clip)).toBe('ok')
  })
})

describe('system voice', () => {
  it('uses say + afconvert on a Mac and never lets the text be read as an option', async () => {
    const calls: Array<[string, string[]]> = []
    const exec = async (f: string, a: string[]) => { calls.push([f, a]); if (f.endsWith('afconvert')) { const { writeFileSync } = await import('node:fs'); writeFileSync(a[a.length - 1]!, Buffer.from('RIFFfake')) } return '' }
    const tts = new SystemTts(exec, 'darwin', async (c) => `/usr/bin/${c}`)
    expect(await tts.available()).toBe(true)
    const out = await tts.synthesize('--version hello')
    expect(Buffer.from(out).toString()).toBe('RIFFfake')
    expect(calls[0]![1].slice(-2)).toEqual(['--', '--version hello'])
    expect(calls[1]![1].slice(0, 4)).toEqual(['-f', 'WAVE', '-d', 'LEI16@24000'])
  })
  it('is unavailable without a speech tool', async () => {
    expect(await new SystemTts(async () => '', 'linux', async () => null).available()).toBe(false)
    await expect(new SystemTts(async () => '', 'linux', async () => null).synthesize('hi')).rejects.toThrow('No system voice')
  })
})
