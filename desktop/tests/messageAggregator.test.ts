import { describe, expect, it } from 'vitest'
import { MessageAggregator } from '../src/main/events/messageAggregator'
import { TurnTracker } from '../src/main/events/turnTracker'

const f = (messageId: string, index: number, delta: string, final = false) => ({ messageId, index, delta, final })

describe('MessageAggregator', () => {
  it('joins in-order batches', () => {
    const a = new MessageAggregator()
    expect(a.ingest(f('m', 0, 'Hello\n'))).toBeNull()
    expect(a.ingest(f('m', 1, 'world', true))).toBe('Hello\nworld')
  })
  it('handles out-of-order delivery', () => {
    const a = new MessageAggregator()
    expect(a.ingest(f('m', 2, 'c', true))).toBeNull()
    expect(a.ingest(f('m', 0, 'a\n'))).toBeNull()
    expect(a.ingest(f('m', 1, 'b\n'))).toBe('a\nb\nc')
  })
  it('ignores duplicate batches and late duplicates after completion', () => {
    const a = new MessageAggregator()
    a.ingest(f('m', 0, 'x\n')); a.ingest(f('m', 0, 'x\n'))
    expect(a.ingest(f('m', 1, '', true))).toBe('x\n')
    expect(a.ingest(f('m', 1, '', true))).toBeNull()
  })
  it('accepts an empty final fragment', () => {
    const a = new MessageAggregator()
    a.ingest(f('m', 0, 'line\n'))
    expect(a.ingest(f('m', 1, '', true))).toBe('line\n')
  })
  it('keeps interleaved messages separate', () => {
    const a = new MessageAggregator()
    a.ingest(f('a', 0, 'A1\n')); a.ingest(f('b', 0, 'B1', true))
    expect(a.ingest(f('a', 1, 'A2', true))).toBe('A1\nA2')
  })
  it('flushes a message with a missing fragment after a timeout', () => {
    const a = new MessageAggregator()
    a.ingest(f('m', 0, 'a\n'), 0); a.ingest(f('m', 2, 'c', true), 0)
    expect(a.flushStale(3000, 5000)).toEqual([{ messageId: 'm', text: 'a\nc' }])
  })
})

describe('TurnTracker', () => {
  it('message followed by tool use is progress; last message is final; no double speak', () => {
    const t = new TurnTracker()
    expect(t.onMessage({ messageId: '1', text: "I'll inspect the module." })).toBeNull()
    expect(t.onToolActivity()?.messageId).toBe('1')
    expect(t.onMessage({ messageId: '2', text: 'All done.' })).toBeNull()
    const end = t.onTurnEnd('All done.')
    expect(end.final?.messageId).toBe('2')
  })
  it('uses Stop.last_assistant_message when it differs from the candidate', () => {
    const t = new TurnTracker()
    t.onMessage({ messageId: '1', text: 'partial' })
    expect(t.onTurnEnd('Complete text').final?.text).toBe('Complete text')
  })
  it('falls back to the candidate when Stop has no text', () => {
    const t = new TurnTracker()
    t.onMessage({ messageId: '1', text: 'only' })
    expect(t.onTurnEnd(null).final?.text).toBe('only')
  })
})
