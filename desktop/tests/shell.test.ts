import { describe, expect, it } from 'vitest'
import { ShellAdapter, userShell } from '../src/main/agents/shell'
import type { EventDraft } from '../src/shared/events'

describe('ShellAdapter', () => {
  it('launches the user\'s own shell with no arguments and tells it nothing about uTerm', async () => {
    const a = new ShellAdapter()
    const l = await a.buildLaunch({ sessionKey: 'abc', nativeSessionId: null, workingDirectory: '/tmp', socketPath: '/tmp/s.sock', instructions: 'speak nicely' })
    expect(l.file).toBe(userShell())
    expect(l.args).toEqual([])
    expect(l.env).toEqual({}) // no ECHO_TERM_SESSION_ID: agents started inside it are not mistaken for managed sessions
    expect((await a.detect()).installed).toBe(true)
  })
  it('prefers $SHELL and falls back to a shell that exists', () => {
    expect(userShell({ SHELL: '/bin/sh' })).toBe('/bin/sh')
    expect(userShell({ SHELL: '/definitely/not/a/shell' })).toMatch(/^\//)
  })
  it('marks the session started so it shows as ready, and emits nothing else', () => {
    const events: EventDraft[] = []
    const o = new ShellAdapter().createObserver({ sessionId: 's', workingDirectory: '/tmp', startedAt: 0, resumedNativeId: null, emit: (d) => events.push(d), claimNativeId: () => true, setTranscriptPath: () => undefined })
    o.start(); o.onHook({ hook_event_name: 'Stop' }); o.stop()
    expect(events.map((e) => e.type)).toEqual(['SESSION_STARTED'])
  })
})
