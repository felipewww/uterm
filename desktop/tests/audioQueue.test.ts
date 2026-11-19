import { describe, expect, it, vi } from 'vitest'
import { AudioQueue, type NewAudioRequest, type QueueDeps } from '../src/main/voice/audioQueue'

function harness(over: Partial<QueueDeps> = {}) {
  let t = 1000
  const played: string[] = []
  const gates: Array<() => void> = []
  const deps: QueueDeps = {
    synthesize: async (text) => new TextEncoder().encode(text),
    play: (audio) => { played.push(new TextDecoder().decode(audio)) },
    finish: () => new Promise<void>((res) => { gates.push(res) }),
    stopPlayback: vi.fn(() => { while (gates.length) gates.shift()!() }),
    revalidate: () => ({ speak: true }),
    now: () => t,
    maxItems: 5,
    ...over
  }
  const q = new AudioQueue(deps)
  const finish = async () => { gates.shift()?.(); await tick() }
  return { q, deps, played, finish, advance: (ms: number) => { t += ms }, gates }
}
const tick = () => new Promise((r) => setTimeout(r, 0))
const req = (o: Partial<NewAudioRequest> & { text: string }): NewAudioRequest => ({
  sessionId: 's1', eventId: 'e', dedupeKey: o.dedupeKey ?? o.text, voiceProfileId: 'default',
  kind: 'final', priority: 2, ttlMs: 60000, ...o
})

describe('AudioQueue', () => {
  it('speaks one request at a time', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'First.' })); h.q.enqueue(req({ text: 'Second.', sessionId: 's2' }))
    await tick()
    expect(h.played).toEqual(['First.'])
    await h.finish()
    expect(h.played).toEqual(['First.', 'Second.'])
  })

  it('orders by priority then arrival while busy', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'busy', kind: 'question', priority: 1, dedupeKey: 'busy' })); await tick()
    h.q.enqueue(req({ text: 'progress', kind: 'progress', priority: 3 }))
    h.q.enqueue(req({ text: 'final2' }))
    h.q.enqueue(req({ text: 'question2', kind: 'question', priority: 1 }))
    await h.finish(); await h.finish(); await h.finish(); await h.finish()
    expect(h.played).toEqual(['busy', 'question2', 'final2', 'progress'])
  })

  it('higher priority interrupts lower-priority playback', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'chatter', kind: 'progress', priority: 3 })); await tick()
    h.q.enqueue(req({ text: 'Need input?', kind: 'question', priority: 1, sessionId: 's2' })); await tick()
    expect(h.deps.stopPlayback).toHaveBeenCalled()
    expect(h.played).toEqual(['chatter', 'Need input?'])
  })

  it('a final cut off by something urgent is replayed once afterwards', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'Final result.' })); await tick()
    h.q.enqueue(req({ text: 'Urgent?', kind: 'question', priority: 1 })); await tick()
    await h.finish(); await h.finish()
    expect(h.played).toEqual(['Final result.', 'Urgent?', 'Final result.'])
  })

  it('does not interrupt for equal priority', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'one' })); await tick()
    h.q.enqueue(req({ text: 'two' })); await tick()
    expect(h.deps.stopPlayback).not.toHaveBeenCalled()
  })

  it('discards expired progress', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'busy' })); await tick()
    h.q.enqueue(req({ text: 'stale', kind: 'progress', priority: 3, ttlMs: 5000 }))
    h.advance(6000)
    await h.finish()
    expect(h.played).toEqual(['busy'])
  })

  it('discards queued progress when the turn completes', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'busy' })); await tick()
    h.q.enqueue(req({ text: 'old progress', kind: 'progress', priority: 3 }))
    h.q.discardProgress('s1')
    await h.finish()
    expect(h.played).toEqual(['busy'])
  })

  it('prevents duplicate playback', async () => {
    const h = harness()
    expect(h.q.enqueue(req({ text: 'a', dedupeKey: 'k' }))).not.toBeNull()
    expect(h.q.enqueue(req({ text: 'a again', dedupeKey: 'k' }))).toBeNull()
  })

  it('limits queue size dropping the least valuable', async () => {
    const h = harness({ maxItems: 2 })
    h.q.enqueue(req({ text: 'busy', kind: 'question', priority: 1 })); await tick()
    h.q.enqueue(req({ text: 'p1', kind: 'progress', priority: 3 }))
    h.q.enqueue(req({ text: 'f1' }))
    h.q.enqueue(req({ text: 'q1', kind: 'question', priority: 1 }))
    expect(h.q.queuedCount).toBe(2)
    await h.finish(); await h.finish(); await h.finish()
    expect(h.played).not.toContain('p1')
  })

  it('re-evaluates policy before playback', async () => {
    let allowed = true
    const h = harness({ revalidate: () => ({ speak: allowed }) })
    h.q.enqueue(req({ text: 'busy' })); await tick()
    h.q.enqueue(req({ text: 'muted later', sessionId: 's2' }))
    allowed = false
    await h.finish()
    expect(h.played).toEqual(['busy'])
  })

  it('cancelSession stops its audio and drops its queue, leaving others', async () => {
    const h = harness()
    h.q.enqueue(req({ text: 'mine', sessionId: 'a' })); await tick()
    h.q.enqueue(req({ text: 'mine2', sessionId: 'a' }))
    h.q.enqueue(req({ text: 'theirs', sessionId: 'b' }))
    h.q.cancelSession('a'); await tick(); await tick()
    expect(h.played).toEqual(['mine', 'theirs'])
  })

  it('ignores results of cancelled synthesis', async () => {
    let resolveSynth!: (a: Uint8Array) => void
    const h = harness({ synthesize: () => new Promise((r) => { resolveSynth = r }) })
    h.q.enqueue(req({ text: 'slow' })); await tick()
    h.q.cancelAll()
    resolveSynth(new TextEncoder().encode('slow')); await tick()
    expect(h.played).toEqual([])
  })

  it('prefixes background session title via revalidate and pipelines chunks', async () => {
    const h = harness({ revalidate: () => ({ speak: true, prefix: 'Auth work:' }) })
    h.q.enqueue(req({ text: 'Done.' })); await tick()
    expect(h.played[0]).toBe('Auth work: Done.')
  })

  it('reports synthesis errors without throwing and continues', async () => {
    const onError = vi.fn()
    const h = harness({ synthesize: async () => { throw new Error('tts down') }, onError })
    h.q.enqueue(req({ text: 'x' })); await tick(); await tick()
    expect(onError).toHaveBeenCalled()
    h.q.enqueue(req({ text: 'y' })); await tick(); await tick()
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('reports generating until audio is ready, then playing, and lists queued events', async () => {
    const states: Array<{ phase: string; queuedEventIds: string[]; speakingEventId: string | null }> = []
    let release!: () => void
    const h = harness({
      synthesize: (text) => new Promise((res) => { release = () => res(new TextEncoder().encode(text)) }),
      onChange: (st) => states.push({ phase: st.phase, queuedEventIds: st.queuedEventIds, speakingEventId: st.speakingEventId })
    })
    h.q.enqueue(req({ text: 'One.', eventId: 'e1' })); h.q.enqueue(req({ text: 'Two.', eventId: 'e2', sessionId: 's2' }))
    await tick()
    expect(states.at(-1)).toMatchObject({ phase: 'generating', speakingEventId: 'e1', queuedEventIds: ['e2'] })
    release(); await tick()
    expect(states.at(-1)).toMatchObject({ phase: 'playing', speakingEventId: 'e1' })
    h.q.cancelAll(); await tick()
    expect(states.at(-1)).toMatchObject({ phase: 'idle', speakingEventId: null, queuedEventIds: [] })
  })
})
