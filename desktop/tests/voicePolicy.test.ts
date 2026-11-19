import { describe, expect, it } from 'vitest'
import { PRIORITY, classifyEvent, effectiveMode, isForeground, modeAllows } from '../src/main/voice/voicePolicy'
import type { AnyAgentEvent } from '../src/shared/events'
import { VOICE_MODES, type SpeechKind } from '../src/shared/types'

const kinds: SpeechKind[] = ['question', 'permission', 'blocker', 'final', 'progress']
const expected: Record<string, SpeechKind[]> = {
  silent: [],
  essential: ['question', 'permission', 'blocker'],
  balanced: ['question', 'permission', 'blocker', 'final'],
  conversational: ['question', 'permission', 'blocker', 'final', 'progress']
}

describe('communication matrix', () => {
  for (const mode of VOICE_MODES) {
    it(`${mode} speaks exactly the specified kinds`, () => {
      expect(kinds.filter((k) => modeAllows(mode, k))).toEqual(expected[mode])
    })
  }
  it('priorities: urgent < final < progress', () => {
    expect(PRIORITY.question).toBe(1); expect(PRIORITY.permission).toBe(1); expect(PRIORITY.blocker).toBe(1)
    expect(PRIORITY.final).toBe(2); expect(PRIORITY.progress).toBe(3)
  })
})

describe('foreground/background', () => {
  const defaults = { defaultForegroundMode: 'balanced', defaultBackgroundMode: 'silent' } as const
  it('selected + focused window is foreground', () => {
    expect(isForeground('a', { selectedSessionId: 'a', windowFocused: true })).toBe(true)
  })
  it('selected but unfocused window is background', () => {
    expect(isForeground('a', { selectedSessionId: 'a', windowFocused: false })).toBe(false)
  })
  it('another session is background; switching tabs re-evaluates immediately', () => {
    const s = { foregroundVoiceMode: 'conversational', backgroundVoiceMode: null } as const
    expect(effectiveMode(s, defaults, isForeground('a', { selectedSessionId: 'a', windowFocused: true }))).toBe('conversational')
    expect(effectiveMode(s, defaults, isForeground('a', { selectedSessionId: 'b', windowFocused: true }))).toBe('silent')
  })
  it('session overrides beat global defaults, independently per side', () => {
    const s = { foregroundVoiceMode: null, backgroundVoiceMode: 'essential' } as const
    expect(effectiveMode(s, defaults, true)).toBe('balanced')
    expect(effectiveMode(s, defaults, false)).toBe('essential')
  })
})

const ev = (type: string, payload: unknown): AnyAgentEvent =>
  ({ id: 'e1', sessionId: 's', nativeSessionId: null, agent: 'claude', type, timestamp: 0, turnId: null, payload }) as AnyAgentEvent

describe('classifyEvent', () => {
  it('speaks questions, permissions (without the raw command), blockers, progress, finals', () => {
    expect(classifyEvent(ev('QUESTION_REQUESTED', { question: 'Redis or Postgres?' }))?.kind).toBe('question')
    const perm = classifyEvent(ev('PERMISSION_REQUESTED', { tool: 'Bash', summary: 'rm -rf /' }))!
    expect(perm.kind).toBe('permission')
    expect(perm.text).not.toContain('rm -rf')
    expect(classifyEvent(ev('AGENT_ERROR', { message: 'x', blocker: true }))?.kind).toBe('blocker')
    expect(classifyEvent(ev('AGENT_ERROR', { message: 'x', blocker: false }))).toBeNull()
    expect(classifyEvent(ev('AGENT_PROGRESS', { messageId: 'm', text: 'hi' }))?.kind).toBe('progress')
    expect(classifyEvent(ev('TURN_COMPLETED', { messageId: 'm', text: 'done' }))?.kind).toBe('final')
  })
  it('never speaks tool noise', () => {
    expect(classifyEvent(ev('TOOL_STARTED', { tool: 'Bash', summary: 'ls' }))).toBeNull()
    expect(classifyEvent(ev('TOOL_COMPLETED', { tool: 'Bash', ok: true }))).toBeNull()
    expect(classifyEvent(ev('ASSISTANT_MESSAGE_DELTA', { messageId: 'm', index: 0, text: 'x' }))).toBeNull()
  })
  it('progress and final for the same message share a dedupe key', () => {
    const a = classifyEvent(ev('AGENT_PROGRESS', { messageId: 'm1', text: 'x' }))!
    const b = classifyEvent(ev('TURN_COMPLETED', { messageId: 'm1', text: 'x' }))!
    expect(a.dedupeKey).toBe(b.dedupeKey)
  })
})
