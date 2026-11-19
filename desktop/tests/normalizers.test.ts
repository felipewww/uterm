import { describe, expect, it } from 'vitest'
import { ClaudeNormalizer } from '../src/main/hooks/claudeNormalizer'
import { CodexTranscriptParser } from '../src/main/agents/codexTranscript'
import { HookEnvelope } from '../src/main/hooks/schemas'

const hook = (name: string, extra: Record<string, unknown> = {}) => ({ hook_event_name: name, session_id: 'native-1', ...extra })
const types = (d: { type: string }[]) => d.map((x) => x.type)

describe('ClaudeNormalizer', () => {
  it('rejects invalid payloads without throwing', () => {
    const n = new ClaudeNormalizer()
    expect(n.normalize({ nope: true })).toEqual([])
    expect(n.normalize({ hook_event_name: 'MessageDisplay', message_id: 5 })).toEqual([])
  })
  it('captures native session id on SessionStart', () => {
    const [e] = new ClaudeNormalizer().normalize(hook('SessionStart', { transcript_path: '/t.jsonl', source: 'startup' }))
    expect(e).toMatchObject({ type: 'SESSION_STARTED', nativeSessionId: 'native-1' })
  })
  it('progress is emitted when a tool follows a message; final on Stop; nothing double', () => {
    const n = new ClaudeNormalizer()
    const all = [
      ...n.normalize(hook('UserPromptSubmit', { prompt: 'fix it' })),
      ...n.normalize(hook('MessageDisplay', { message_id: 'm1', index: 0, final: false, delta: "I'll look at auth.\n" })),
      ...n.normalize(hook('MessageDisplay', { message_id: 'm1', index: 1, final: true, delta: '' })),
      ...n.normalize(hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'a.ts' } })),
      ...n.normalize(hook('PostToolUse', { tool_name: 'Read' })),
      ...n.normalize(hook('MessageDisplay', { message_id: 'm2', index: 0, final: true, delta: 'Done. Tests pass.' })),
      ...n.normalize(hook('Stop', { last_assistant_message: 'Done. Tests pass.' }))
    ]
    const progress = all.filter((e) => e.type === 'AGENT_PROGRESS')
    expect(progress).toHaveLength(1)
    expect(progress[0]!.payload).toMatchObject({ messageId: 'm1' })
    const turn = all.find((e) => e.type === 'TURN_COMPLETED')!
    expect(turn.payload).toMatchObject({ messageId: 'm2', text: 'Done. Tests pass.' })
  })
  it('maps AskUserQuestion to QUESTION_REQUESTED, not a tool start', () => {
    const d = new ClaudeNormalizer().normalize(hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Redis or Postgres?' }] } }))
    expect(types(d)).toEqual(['QUESTION_REQUESTED'])
  })
  it('maps PermissionRequest and StopFailure', () => {
    const n = new ClaudeNormalizer()
    expect(types(n.normalize(hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } })))).toEqual(['PERMISSION_REQUESTED'])
    expect(n.normalize(hook('StopFailure', { error_type: 'rate_limit' }))[0]).toMatchObject({ type: 'AGENT_ERROR', payload: { blocker: true } })
  })
})

describe('CodexTranscriptParser', () => {
  const line = (o: unknown) => JSON.stringify(o)
  const msg = (id: string, phase: string, text: string) => line({
    timestamp: '2026-11-13T12:44:22.422Z', type: 'response_item',
    payload: { type: 'message', id, role: 'assistant', phase, content: [{ type: 'output_text', text }] }
  })
  it('commentary => progress, final_answer => final on task_complete, deduped', () => {
    const p = new CodexTranscriptParser()
    const out = [
      ...p.parseLine(line({ type: 'session_meta', payload: { id: 'codex-1', source: 'cli' } })),
      ...p.parseLine(line({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } })),
      ...p.parseLine(msg('a', 'commentary', "I'll read the README.")),
      ...p.parseLine(msg('a', 'commentary', "I'll read the README.")), // duplicate line
      ...p.parseLine(msg('b', 'final_answer', 'Read it. Summary follows.')),
      ...p.parseLine(line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: 'Read it. Summary follows.' } }))
    ]
    expect(out[0]).toMatchObject({ type: 'SESSION_STARTED', nativeSessionId: 'codex-1' })
    expect(out.filter((e) => e.type === 'AGENT_PROGRESS')).toHaveLength(1)
    const done = out.find((e) => e.type === 'TURN_COMPLETED')!
    expect(done.payload).toMatchObject({ messageId: 'b', text: 'Read it. Summary follows.' })
  })
  it('ignores garbage lines', () => {
    expect(new CodexTranscriptParser().parseLine('not json')).toEqual([])
  })
})

describe('HookEnvelope', () => {
  it('requires a managed session key and a known agent', () => {
    expect(HookEnvelope.safeParse({ v: 1, agent: 'claude', sessionKey: 'nope', payload: {} }).success).toBe(false)
    expect(HookEnvelope.safeParse({ v: 1, agent: 'evil', sessionKey: crypto.randomUUID(), payload: {} }).success).toBe(false)
    expect(HookEnvelope.safeParse({ v: 1, agent: 'codex', sessionKey: crypto.randomUUID(), payload: { a: 1 } }).success).toBe(true)
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('real Codex 0.169 transcript fixture', () => {
  const lines = readFileSync(join(__dirname, 'fixtures', 'codex-turn.jsonl'), 'utf8').split('\n').filter(Boolean)
  const drafts = (() => { const p = new CodexTranscriptParser(); return lines.flatMap((l) => p.parseLine(l)) })()

  it('captures the native session id, the prompt, one progress message and the final answer', () => {
    expect(drafts.find((d) => d.type === 'SESSION_STARTED')).toMatchObject({ nativeSessionId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(drafts.find((d) => d.type === 'USER_PROMPT_SUBMITTED')?.payload).toMatchObject({ prompt: expect.stringContaining('hello.txt') })
    expect(drafts.filter((d) => d.type === 'AGENT_PROGRESS')).toHaveLength(1)
    const done = drafts.filter((d) => d.type === 'TURN_COMPLETED')
    expect(done).toHaveLength(1)
    expect((done[0]!.payload as { text: string }).text).toContain('echo-term-fixture')
  })
  it('does not treat the final answer as progress', () => {
    const progress = drafts.find((d) => d.type === 'AGENT_PROGRESS')!.payload as { text: string }
    const final = drafts.find((d) => d.type === 'TURN_COMPLETED')!.payload as { text: string }
    expect(progress.text).not.toBe(final.text)
  })
})
