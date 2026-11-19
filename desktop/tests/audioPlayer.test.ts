import { beforeEach, describe, expect, it, vi } from 'vitest'

function wav(seconds: number, rate = 24000): ArrayBuffer {
  const data = Math.round(seconds * rate) * 2
  const b = new Uint8Array(44 + data)
  const v = new DataView(b.buffer)
  const put = (o: number, t: string) => b.set([...t].map((c) => c.charCodeAt(0)), o)
  put(0, 'RIFF'); v.setUint32(4, 36 + data, true); put(8, 'WAVEfmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  put(36, 'data'); v.setUint32(40, data, true)
  return b.buffer
}

class FakeAudio {
  static last: FakeAudio
  src = ''; currentTime = 0; playbackRate = 1; preservesPitch = false
  onended: (() => void) | null = null; onerror: (() => void) | null = null; onloadedmetadata: (() => void) | null = null
  paused = true
  plays: string[] = []
  constructor() { FakeAudio.last = this }
  play() { this.paused = false; this.plays.push(this.src); return Promise.resolve() }
  pause() { this.paused = true }
  /** the browser finishing the current chunk */
  end() { this.onended?.() }
}

type Chunk = { requestId: string; eventId: string; sessionId: string; index: number; total: number; speed: number; data: ArrayBuffer }
const chunk = (index: number, total: number, seconds: number, over: Partial<Chunk> = {}): Chunk => ({ requestId: 'r1', eventId: 'e1', sessionId: 's1', index, total, speed: 1, data: wav(seconds), ...over })

async function load() {
  vi.resetModules()
  let onChunk!: (c: Chunk) => void; let onStop!: () => void
  const ended: string[] = []
  let stopCalls = 0
  let n = 0
  const g = globalThis as Record<string, unknown>
  g.Audio = FakeAudio
  g.requestAnimationFrame = () => 1
  g.cancelAnimationFrame = () => undefined
  g.URL = Object.assign(URL, { createObjectURL: () => `blob:${++n}`, revokeObjectURL: () => undefined })
  g.window = {
    setTimeout: (...a: Parameters<typeof setTimeout>) => setTimeout(...a),
    echo: {
      events: { onAudioChunk: (cb: (c: Chunk) => void) => { onChunk = cb; return () => undefined }, onAudioStop: (cb: () => void) => { onStop = cb; return () => undefined } },
      voice: { audioEnded: ({ requestId }: { requestId: string }) => { ended.push(requestId); return Promise.resolve() }, stopPlayback: () => { stopCalls++; onStop(); return Promise.resolve() } }
    }
  }
  const m = await import('../src/renderer/composables/useAudioPlayer')
  m.installAudioPlayer()
  return { m, push: (c: Chunk) => onChunk(c), stop: () => onStop(), ended, stopCalls: () => stopCalls, audio: () => FakeAudio.last }
}

describe('audio player', () => {
  beforeEach(() => { vi.useRealTimers() })

  it('starts on the first chunk, moves through the rest, and tells main only when the whole message is done', async () => {
    const t = await load()
    t.push(chunk(0, 2, 3)); t.push(chunk(1, 2, 2))
    const tr = t.m.tracks.e1!
    expect(tr.status).toBe('playing')
    expect(tr.complete).toBe(true)
    expect(t.m.totalOf(tr)).toBeCloseTo(5, 3)
    t.audio().end() // chunk 0 over -> chunk 1
    expect(t.audio().plays).toEqual(['blob:1', 'blob:2'])
    expect(t.ended).toEqual([])
    t.audio().end() // last chunk over
    expect(tr.status).toBe('ended')
    expect(t.ended).toEqual(['r1'])
  })

  it('waits (buffering) when the voice is behind, then continues when the next chunk arrives', async () => {
    const t = await load()
    t.push(chunk(0, 2, 3))
    t.audio().end()
    expect(t.m.tracks.e1!.status).toBe('buffering')
    expect(t.ended).toEqual([])
    t.push(chunk(1, 2, 2))
    expect(t.m.tracks.e1!.status).toBe('playing')
    expect(t.audio().src).toBe('blob:2')
  })

  it('seeks across chunk boundaries and keeps the paused state', async () => {
    const t = await load()
    t.push(chunk(0, 2, 3)); t.push(chunk(1, 2, 2))
    await t.m.seekTo('e1', 4) // 1 s into the second chunk
    expect(t.audio().src).toBe('blob:2')
    t.audio().onloadedmetadata?.()
    expect(t.audio().currentTime).toBeCloseTo(1, 3)
    expect(t.m.tracks.e1!.position).toBeCloseTo(4, 3)
    await t.m.togglePlay('e1') // pause
    expect(t.m.tracks.e1!.status).toBe('paused')
    await t.m.seekTo('e1', 1)
    expect(t.audio().src).toBe('blob:1')
    expect(t.m.tracks.e1!.status).toBe('paused') // scrubbing while paused does not start playback
    await t.m.togglePlay('e1')
    expect(t.m.tracks.e1!.status).toBe('playing')
  })

  it('replays a finished message from the start without asking main for anything', async () => {
    const t = await load()
    t.push(chunk(0, 1, 2)); t.audio().end()
    expect(t.m.tracks.e1!.status).toBe('ended')
    await t.m.togglePlay('e1')
    expect(t.m.tracks.e1!.status).toBe('playing')
    expect(t.m.tracks.e1!.position).toBe(0)
    expect(t.ended).toEqual(['r1']) // still just the first completion
  })

  it('a stop from main pauses the owned track and ignores chunks that arrive afterwards', async () => {
    const t = await load()
    t.push(chunk(0, 3, 2))
    t.stop()
    expect(t.m.tracks.e1!.status).toBe('paused')
    t.push(chunk(1, 3, 2)) // late chunk of the cancelled request
    expect(t.m.tracks.e1!.chunks.length).toBe(1)
    expect(t.m.tracks.e1!.complete).toBe(false)
  })

  it('a replay the user started is not stopped by main, and a new message takes the speaker over', async () => {
    const t = await load()
    t.push(chunk(0, 1, 2)); t.audio().end()
    await t.m.togglePlay('e1') // user replay (not owned)
    t.stop()
    expect(t.m.tracks.e1!.status).toBe('playing')
    t.push(chunk(0, 1, 1, { requestId: 'r2', eventId: 'e2' })) // main speaks something else
    expect(t.m.tracks.e1!.status).toBe('paused')
    expect(t.m.tracks.e2!.status).toBe('playing')
  })

  it('releases the voice queue when an owned message stays paused for a long time', async () => {
    vi.useFakeTimers()
    const t = await load()
    t.push(chunk(0, 1, 5))
    await t.m.togglePlay('e1') // pause
    expect(t.ended).toEqual([])
    vi.advanceTimersByTime(61_000)
    expect(t.ended).toEqual(['r1'])
    expect(t.m.tracks.e1!.status).toBe('paused') // still resumable locally
  })

  it('regenerating a message replaces its old track', async () => {
    const t = await load()
    t.push(chunk(0, 1, 2)); t.audio().end()
    t.push(chunk(0, 1, 4, { requestId: 'r9' }))
    expect(t.m.tracks.e1!.requestId).toBe('r9')
    expect(t.m.totalOf(t.m.tracks.e1!)).toBeCloseTo(4, 3)
  })
})
