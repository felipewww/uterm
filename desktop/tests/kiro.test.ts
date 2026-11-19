import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KiroTranscriptParser } from '../src/main/agents/kiroTranscript'
import { KiroAdapter, readKiroMeta } from '../src/main/agents/kiro'
import { extraBinDirs, searchPath, which } from '../src/main/agents/exec'
import type { EventDraft } from '../src/shared/events'

const lines = readFileSync(join(__dirname, 'fixtures/kiro-session.jsonl'), 'utf8').split('\n').filter(Boolean)
const parse = (ls: string[]): EventDraft[] => { const p = new KiroTranscriptParser(); return ls.flatMap((l) => p.parseLine(l)) }

describe('KiroTranscriptParser (structure verified against kiro-cli 2.34)', () => {
  it('turns a prompt → tool → answer exchange into the normalized events', () => {
    const types = parse(lines).map((e) => e.type)
    expect(types).toEqual([
      'USER_PROMPT_SUBMITTED',
      'ASSISTANT_MESSAGE_COMPLETED', 'AGENT_PROGRESS', 'TOOL_STARTED',
      'TOOL_COMPLETED',
      'ASSISTANT_MESSAGE_COMPLETED', 'TURN_COMPLETED'
    ])
  })

  it('narration before a tool call is progress; the message without a tool call is the final result', () => {
    const ev = parse(lines)
    const progress = ev.find((e) => e.type === 'AGENT_PROGRESS')
    const final = ev.find((e) => e.type === 'TURN_COMPLETED')
    expect(progress && 'text' in progress.payload && progress.payload.text).toBe("I'll look at the folder first.")
    expect(final && 'text' in final.payload && final.payload.text).toBe('The folder is empty.')
  })

  it('describes tools for display only and pairs results with their tool', () => {
    const ev = parse(lines)
    const started = ev.find((e) => e.type === 'TOOL_STARTED')
    const done = ev.find((e) => e.type === 'TOOL_COMPLETED')
    expect(started?.payload).toEqual({ tool: 'shell', summary: 'ls -la' })
    expect(done?.payload).toEqual({ tool: 'shell', ok: true })
  })

  it('never surfaces thinking blocks', () => {
    expect(JSON.stringify(parse(lines))).not.toContain('thinking')
  })

  it('ignores repeated message ids and unknown or broken lines', () => {
    const p = new KiroTranscriptParser()
    const assistant = lines[3]!
    expect(p.parseLine(assistant).length).toBeGreaterThan(0)
    expect(p.parseLine(assistant)).toEqual([])
    expect(p.parseLine('{not json')).toEqual([])
    expect(p.parseLine(JSON.stringify({ version: 'v1', kind: 'Mystery', data: {} }))).toEqual([])
  })

  it('a final with no text still ends the turn', () => {
    const ev = parse([JSON.stringify({ version: 'v1', kind: 'AssistantMessage', data: { message_id: 'x', content: [{ kind: 'thinking', data: {} }] } })])
    expect(ev.map((e) => e.type)).toEqual(['TURN_COMPLETED'])
  })
})

describe('Kiro session discovery', () => {
  it('reads session metadata (id, cwd) from <id>.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kiro-meta-'))
    const f = join(dir, 'abc.json')
    writeFileSync(f, JSON.stringify({ session_id: 'abc', cwd: '/tmp/x', created_at: '2026-11-19T15:51:08.188564039Z', title: 'Hi' }))
    expect(readKiroMeta(f)).toMatchObject({ id: 'abc', cwd: '/tmp/x', title: 'Hi' })
    writeFileSync(f, '{"nope":1}')
    expect(readKiroMeta(f)).toBeNull()
  })

  it('attaches to the new session of the same folder, claims it once and emits its events', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kiro-home-'))
    const dir = join(home, 'sessions', 'cli'); mkdirSync(dir, { recursive: true })
    process.env.KIRO_HOME = home
    const events: string[] = []
    const claimed: string[] = []
    const obs = new KiroAdapter().createObserver({
      sessionId: 's1', workingDirectory: '/work/proj', startedAt: Date.now() - 500, resumedNativeId: null,
      emit: (d) => events.push(d.type), claimNativeId: (id) => { claimed.push(id); return true }, setTranscriptPath: () => undefined
    })
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ session_id: 'other', cwd: '/somewhere/else', created_at: new Date().toISOString() }))
    writeFileSync(join(dir, 'mine.json'), JSON.stringify({ session_id: 'mine', cwd: '/work/proj', created_at: new Date().toISOString() }))
    writeFileSync(join(dir, 'mine.jsonl'), lines.join('\n') + '\n')
    obs.start()
    await new Promise((r) => setTimeout(r, 900))
    obs.stop()
    delete process.env.KIRO_HOME
    expect(claimed).toEqual(['mine'])
    expect(events[0]).toBe('SESSION_STARTED')
    expect(events).toContain('TURN_COMPLETED')
  })
})

describe('finding installed CLIs', () => {
  it('searches the usual install folders even when the inherited PATH is minimal (GUI launch)', () => {
    const p = searchPath('/usr/bin:/bin', ['/home/me/.local/bin', '/usr/bin'])
    expect(p.split(':')).toEqual(['/usr/bin', '/bin', '/home/me/.local/bin'])
    expect(extraBinDirs('/Users/me', 'darwin')).toContain('/opt/homebrew/bin')
    expect(extraBinDirs('/Users/me', 'darwin')).toContain('/Users/me/.local/bin')
  })

  it('finds an executable only in an extra folder, and reports a missing one as not installed', async () => {
    const bin = mkdtempSync(join(tmpdir(), 'bin-'))
    const exe = join(bin, 'fake-kiro-cli'); writeFileSync(exe, '#!/bin/sh\necho 1\n'); chmodSync(exe, 0o755)
    expect(await which('fake-kiro-cli', searchPath('/nonexistent', [bin]))).toBe(exe)
    expect(await which('definitely-not-installed-cli-xyz', searchPath('/nonexistent', [bin]))).toBeNull()
  })
})
