import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalDb, SqliteCoachHistory, SqliteCommandStore, SqliteEventStore, SqliteSessionRepo, SqliteSettings, SqliteUsageStore } from '../src/main/db/sqliteStore'

describe('local SQLite database (no MySQL)', () => {
  it('keeps sessions, folders and their rules across a restart', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'sq-')), 'data', 'uterm.db')
    const d1 = new LocalDb(f); const a = new SqliteSessionRepo(d1)
    const folder = await a.createFolder('Work'); const sub = await a.createFolder('Sub', folder.id)
    const s = await a.create({ agentType: 'claude', title: 'T', workingDirectory: '/tmp' })
    const s2 = await a.create({ agentType: 'claude', title: 'U', workingDirectory: '/tmp' })
    await a.setFolder(s.id, sub.id); await a.update(s.id, { lastCwd: '/var', englishCoach: true, playbackSpeed: 1.25 })
    expect(await a.setNativeSessionId(s.id, 'n1')).toBe('ok')
    expect(await a.setNativeSessionId(s2.id, 'n1')).toBe('duplicate') // one native conversation, one session
    await a.deleteFolder(sub.id) // its sessions move up to the parent
    d1.close()
    const b = new SqliteSessionRepo(new LocalDb(f))
    const got = await b.get(s.id)
    expect(got).toMatchObject({ title: 'T', folderId: folder.id, lastCwd: '/var', englishCoach: true, playbackSpeed: 1.25, nativeSessionId: 'n1' })
    expect((await b.findByNative('claude', 'n1'))?.id).toBe(s.id)
    expect((await b.listFolders()).map((x) => x.name)).toEqual(['Work'])
    await b.delete(s.id)
    expect(await b.get(s.id)).toBeNull()
  })

  it('stores activity with spoken / natural marks, usage totals, commands and settings', async () => {
    const d = new LocalDb(':memory:')
    const sessions = new SqliteSessionRepo(d); const ev = new SqliteEventStore(d); const coach = new SqliteCoachHistory(d)
    const usage = new SqliteUsageStore(d); const cmds = new SqliteCommandStore(d); const settings = new SqliteSettings(d)
    const s = await sessions.create({ agentType: 'shell', title: 'T', workingDirectory: '/tmp' })
    await ev.record({ id: 'e1', sessionId: s.id, type: 'AGENT_PROGRESS', turnId: null, timestamp: 5, payload: { text: 'hello' } } as never)
    await ev.record({ id: 'e2', sessionId: s.id, type: 'TOOL_STARTED', turnId: null, timestamp: 6, payload: {} } as never) // not a persisted type
    await ev.recordSpoken(s.id, 'e1', null, 1, 'hello')
    await coach.record({ sessionId: s.id, eventId: 'e1', original: 'hi', natural: 'Hello there' })
    expect(await ev.recent(s.id)).toMatchObject([{ id: 'e1', spoken: true, natural: 'Hello there', payload: { text: 'hello' } }])
    await usage.record({ provider: 'gemini', model: 'm', kind: 'tts', costUsd: 0.5, chars: 3 } as never)
    await usage.record({ provider: 'gemini', model: 'm', kind: 'tts', costUsd: null, chars: 2 } as never)
    expect((await usage.summary()).all).toMatchObject([{ provider: 'gemini', kind: 'tts', calls: 2, costUsd: 0.5, chars: 5, unpriced: 1 }])
    const c = await cmds.add(s.id, 'npm run dev', 'dev'); await cmds.add(s.id, 'ls')
    expect((await cmds.list(s.id)).map((x) => x.command)).toEqual(['npm run dev', 'ls'])
    expect((await cmds.get(c.id))?.label).toBe('dev'); await cmds.remove(c.id)
    expect((await cmds.list(s.id)).length).toBe(1)
    await settings.save({ globalMute: true } as never)
    expect((await settings.load()).globalMute).toBe(true)
    await sessions.delete(s.id) // takes its activity and commands with it
    expect(await ev.recent(s.id)).toEqual([]); expect(await cmds.list(s.id)).toEqual([])
  })
})
