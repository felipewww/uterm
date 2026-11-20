import { describe, expect, it } from 'vitest'
import { chimeFor, type ChimeContext } from '../src/renderer/notify'
import { DEFAULT_SETTINGS } from '../src/shared/types'

const ctx = (over: Partial<ChimeContext> = {}): ChimeContext => ({
  eventType: 'TURN_COMPLETED', sessionId: 's1', selectedId: 's2', windowFocused: true, sessionMuted: false, recording: false,
  settings: { ...DEFAULT_SETTINGS }, ...over
})

describe('notification sounds', () => {
  it('a finished turn in a session you are not looking at plays the soft "done" sound', () => {
    expect(chimeFor(ctx())).toBe('done')
  })
  it('questions, approvals, notices and blocking errors play the "attention" sound; other errors stay quiet', () => {
    for (const eventType of ['QUESTION_REQUESTED', 'PERMISSION_REQUESTED', 'ATTENTION_REQUIRED']) expect(chimeFor(ctx({ eventType })), eventType).toBe('attention')
    expect(chimeFor(ctx({ eventType: 'AGENT_ERROR', blocker: true }))).toBe('attention')
    expect(chimeFor(ctx({ eventType: 'AGENT_ERROR', blocker: false }))).toBeNull()
    expect(chimeFor(ctx({ eventType: 'TOOL_STARTED' }))).toBeNull()
  })
  it('is silent for the session in front of a focused window, but not when the window is unfocused', () => {
    expect(chimeFor(ctx({ selectedId: 's1', windowFocused: true }))).toBeNull()
    expect(chimeFor(ctx({ selectedId: 's1', windowFocused: false }))).toBe('done') // you are in another app
  })
  it('respects the switches, mute, and never makes noise while you record', () => {
    expect(chimeFor(ctx({ settings: { ...DEFAULT_SETTINGS, notifySounds: false } }))).toBeNull()
    expect(chimeFor(ctx({ settings: { ...DEFAULT_SETTINGS, notifyOnDone: false } }))).toBeNull()
    expect(chimeFor(ctx({ eventType: 'QUESTION_REQUESTED', settings: { ...DEFAULT_SETTINGS, notifyOnAttention: false } }))).toBeNull()
    expect(chimeFor(ctx({ sessionMuted: true }))).toBeNull()
    expect(chimeFor(ctx({ settings: { ...DEFAULT_SETTINGS, globalMute: true } }))).toBeNull()
    expect(chimeFor(ctx({ recording: true }))).toBeNull()
  })
})
