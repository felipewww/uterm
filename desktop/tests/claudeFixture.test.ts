import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ClaudeNormalizer } from '../src/main/hooks/claudeNormalizer'
import { ReorderBuffer } from '../src/main/hooks/reorderBuffer'
import { classifyEvent } from '../src/main/voice/voicePolicy'
import type { EventDraft } from '../src/shared/events'

// Recorded from a real Claude Code 2.1.328 session via tests/smoke/agent-smoke.cjs.
interface Env { seq: number; payload: Record<string, unknown> }
const fixture: Env[] = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'claude-turn.json'), 'utf8'))

function replay(arrival: Env[]): EventDraft[] {
  const out: EventDraft[] = []
  const n = new ClaudeNormalizer()
  let t = 1000
  const buf = new ReorderBuffer<Env>(50, (items) => items.forEach((i) => out.push(...n.normalize(i.payload, t))), () => t)
  for (const e of arrival) { buf.push(e); t += 1 }
  t += 100; buf.flush()
  out.push(...n.tick(t + 5000))
  return out
}

describe('real Claude Code fixture', () => {
  const shuffles = [fixture, [...fixture].reverse(), [fixture[3]!, fixture[6]!, fixture[0]!, fixture[5]!, fixture[2]!, fixture[4]!, fixture[1]!]]
  for (const [i, arrival] of shuffles.entries()) {
    it(`arrival order #${i}: one progress message, one final, no duplicates`, () => {
      const drafts = replay(arrival)
      const types = drafts.map((d) => d.type)
      expect(types.filter((t) => t === 'AGENT_PROGRESS')).toHaveLength(1)
      expect(types.filter((t) => t === 'TURN_COMPLETED')).toHaveLength(1)
      const progress = drafts.find((d) => d.type === 'AGENT_PROGRESS')!
      expect((progress.payload as { text: string }).text).toContain('hello.txt')
      const done = drafts.find((d) => d.type === 'TURN_COMPLETED')!
      expect((done.payload as { text: string }).text).toContain('echo-term-fixture')
      // The final text is never also spoken as progress.
      const progressKey = `m:${(progress.payload as { messageId: string }).messageId}`
      const finalKey = `m:${(done.payload as { messageId: string }).messageId}`
      expect(progressKey).not.toBe(finalKey)
    })
  }

  it('tool events are not conversational, SessionStart carries the native id', () => {
    const drafts = replay(fixture)
    expect(drafts[0]).toMatchObject({ type: 'SESSION_STARTED', nativeSessionId: expect.any(String) })
    const spoken = drafts.map((d) => classifyEvent({ id: 'x', sessionId: 's', nativeSessionId: null, agent: 'claude', timestamp: 0, turnId: null, ...d } as never)).filter(Boolean)
    expect(spoken.map((s) => s!.kind).sort()).toEqual(['final', 'progress'])
  })
})

describe('ReorderBuffer', () => {
  it('releases sorted by seq after the window and keeps arrival order for ties', () => {
    const out: number[] = []
    let t = 0
    const b = new ReorderBuffer<{ seq: number }>(100, (items) => out.push(...items.map((i) => i.seq)), () => t)
    b.push({ seq: 3 }); b.push({ seq: 1 }); b.push({ seq: 2 })
    t = 50; b.flush(); expect(out).toEqual([])
    t = 150; b.flush(); expect(out).toEqual([1, 2, 3])
  })
})
