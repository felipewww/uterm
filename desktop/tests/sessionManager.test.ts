import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter } from '../src/main/agents/adapter'
import { MemorySessionRepo } from '../src/main/db/memoryStore'
import { EventBus } from '../src/main/events/eventBus'
import { PtyManager, type PtyProcess, type SpawnSpec } from '../src/main/pty/ptyManager'
import { SessionManager } from '../src/main/sessionManager'
import { DEFAULT_SETTINGS, type AgentType, type SessionView } from '../src/shared/types'

class FakePty implements PtyProcess {
  pid = Math.floor(Math.random() * 1e5)
  written: string[] = []
  killed: string[] = []
  private dataCb: (d: string) => void = () => undefined
  private exitCb: (c: number, s: number | undefined) => void = () => undefined
  onData(cb: (d: string) => void) { this.dataCb = cb }
  onExit(cb: (c: number, s: number | undefined) => void) { this.exitCb = cb }
  write(d: string) { this.written.push(d) }
  resize() { /* noop */ }
  kill(sig?: string) { this.killed.push(sig ?? 'SIGTERM'); queueMicrotask(() => this.exitCb(0, undefined)) }
  emit(d: string) { this.dataCb(d) }
}

function setup() {
  const procs: Array<{ spec: SpawnSpec; proc: FakePty }> = []
  const ptyHooks = { onData: vi.fn(), onExit: (id: string, code: number) => mgr.onPtyExit(id, code) }
  const pty = new PtyManager((spec) => { const proc = new FakePty(); procs.push({ spec, proc }); return proc }, ptyHooks)
  const observers: Array<{ hooks: unknown[]; ctx: Parameters<AgentAdapter['createObserver']>[0] }> = []
  const launches: Array<{ native: string | null }> = []
  const adapter = (type: AgentType): AgentAdapter => ({
    type, label: type, capabilities: { preassignedSessionId: false, intermediateMessages: 'none', permissionRequests: 'none', interactiveQuestions: 'none', notes: [] },
    detect: async () => ({ installed: true, path: `/bin/${type}`, version: '1' }),
    buildLaunch: async (i) => { launches.push({ native: i.nativeSessionId }); return { file: `/bin/${type}`, args: i.nativeSessionId ? ['resume', i.nativeSessionId] : [], env: { ECHO_TERM_SESSION_ID: i.sessionKey } } },
    createObserver: (ctx) => { const o = { hooks: [] as unknown[], ctx }; observers.push(o); return { onHook: (p) => { o.hooks.push(p) }, start() { /* noop */ }, stop() { /* noop */ } } }
  })
  const views: SessionView[] = []
  const persistenceErrors: string[] = []
  const repo = new MemorySessionRepo()
  const deps = {
    repo, pty, bus: new EventBus(), adapters: { claude: adapter('claude'), codex: adapter('codex'), kiro: adapter('kiro') },
    socketPath: '/tmp/x.sock', settings: () => DEFAULT_SETTINGS, speechInstructions: () => null,
    onViewChanged: (v: SessionView) => views.push(v), onPersistenceError: (m: string) => persistenceErrors.push(m)
  }
  const mgr: SessionManager = new SessionManager(deps)
  return { deps, mgr, repo, procs, observers, launches, views, persistenceErrors, pty }
}
const dir = () => mkdtempSync(join(tmpdir(), 'echo-sm-'))

describe('SessionManager', () => {
  it('creates a session, spawns the agent with its session key, and starts in STARTING', async () => {
    const t = setup()
    const v = await t.mgr.create({ agentType: 'claude', title: 'Auth', workingDirectory: dir() })
    expect(v.running).toBe(true)
    expect(t.mgr.runtimeState(v.id)).toBe('STARTING')
    expect(t.procs[0]!.spec.env.ECHO_TERM_SESSION_ID).toBe(v.id)
    expect(t.procs[0]!.spec.env.ECHO_TERM_DB_PASSWORD).toBeUndefined()
  })

  it('rejects a missing working directory', async () => {
    await expect(setup().mgr.create({ agentType: 'claude', title: 'x', workingDirectory: '/definitely/not/here' })).rejects.toThrow(/does not exist/)
  })

  it('switching selection never stops processes; closing one stops only that one', async () => {
    const t = setup()
    const a = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
    const b = await t.mgr.create({ agentType: 'codex', title: 'B', workingDirectory: dir() })
    t.mgr.select(a.id); t.mgr.select(b.id); t.mgr.select(a.id)
    expect(t.mgr.isRunning(a.id) && t.mgr.isRunning(b.id)).toBe(true)
    await t.mgr.stop(a.id)
    expect(t.mgr.isRunning(a.id)).toBe(false)
    expect(t.mgr.isRunning(b.id)).toBe(true)
    expect(t.mgr.getRecord(a.id)).toBeDefined() // metadata preserved
  })

  it('resumes with the stored native id, never "most recent in directory"', async () => {
    const t = setup()
    const v = await t.mgr.create({ agentType: 'codex', title: 'C', workingDirectory: dir() })
    t.observers[0]!.ctx.claimNativeId('native-123')
    await t.mgr.stop(v.id)
    await t.mgr.start(v.id, 100, 30)
    expect(t.launches.at(-1)!.native).toBe('native-123')
    expect(t.procs.at(-1)!.spec.args).toEqual(['resume', 'native-123'])
  })

  it('prevents two running processes on the same native conversation', async () => {
    const t = setup()
    const d = dir()
    const a = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: d })
    t.observers[0]!.ctx.claimNativeId('shared')
    const imported = await t.repo.create({ agentType: 'claude', title: 'dup', workingDirectory: d, nativeSessionId: null })
    await t.mgr.load()
    expect(t.observers[0]!.ctx.claimNativeId('shared')).toBe(true)
    // a second record trying to claim the same native id while A runs is refused
    await t.mgr.start(imported.id, 100, 30)
    expect(t.observers[1]!.ctx.claimNativeId('shared')).toBe(false)
    void a
  })

  it('refuses to start an imported duplicate conversation that is already running', async () => {
    const t = setup()
    const d = dir()
    const a = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: d })
    t.observers[0]!.ctx.claimNativeId('conv-1')
    const dup = await t.mgr.importNative({ agentType: 'claude', nativeSessionId: 'conv-1', workingDirectory: d, title: 'again' })
    expect(dup.id).toBe(a.id) // import is idempotent: returns the existing session
  })

  it('runtime state follows events and is never persisted: after restart sessions are CLOSED', async () => {
    const t = setup()
    const v = await t.mgr.create({ agentType: 'claude', title: 'S', workingDirectory: dir() })
    t.mgr.emit(v.id, { type: 'SESSION_STARTED', payload: {} }); expect(t.mgr.runtimeState(v.id)).toBe('IDLE')
    t.mgr.emit(v.id, { type: 'USER_PROMPT_SUBMITTED', payload: { prompt: 'x' } }); expect(t.mgr.runtimeState(v.id)).toBe('WORKING')
    t.mgr.emit(v.id, { type: 'PERMISSION_REQUESTED', payload: { tool: 'Bash', summary: '' } }); expect(t.mgr.runtimeState(v.id)).toBe('WAITING_FOR_PERMISSION')
    t.mgr.emit(v.id, { type: 'TURN_COMPLETED', payload: { messageId: null, text: null } }); expect(t.mgr.runtimeState(v.id)).toBe('IDLE')
    const fresh = new SessionManager(t.deps)
    await fresh.load()
    expect(fresh.view(v.id)!.running).toBe(false)
    expect(fresh.runtimeState(v.id)).toBe('CLOSED')
  })

  it('marks attention only for non-selected sessions and clears it on select', async () => {
    const t = setup()
    const a = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
    const b = await t.mgr.create({ agentType: 'claude', title: 'B', workingDirectory: dir() })
    t.mgr.select(a.id)
    t.mgr.emit(a.id, { type: 'QUESTION_REQUESTED', payload: { question: '?' } })
    t.mgr.emit(b.id, { type: 'QUESTION_REQUESTED', payload: { question: '?' } })
    expect(t.mgr.view(a.id)!.needsAttention).toBe(false)
    expect(t.mgr.view(b.id)!.needsAttention).toBe(true)
    t.mgr.select(b.id)
    expect(t.mgr.view(b.id)!.needsAttention).toBe(false)
  })

  it('ignores hooks for unmanaged, stale or wrong-agent sessions', async () => {
    const t = setup()
    const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
    t.mgr.handleHook({ agent: 'claude', sessionKey: crypto.randomUUID(), payload: { hook_event_name: 'Stop' } })
    t.mgr.handleHook({ agent: 'codex', sessionKey: v.id, payload: { hook_event_name: 'Stop' } })
    t.mgr.handleHook({ agent: 'claude', sessionKey: v.id, seq: 1, payload: { hook_event_name: 'Stop' } })
    await new Promise((r) => setTimeout(r, 300))
    expect(t.observers[0]!.hooks).toHaveLength(1)
  })

  describe('voice transcript delivery', () => {
    it('pastes with bracketed paste and submits when idle', async () => {
      const t = setup()
      const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
      t.mgr.emit(v.id, { type: 'SESSION_STARTED', payload: {} })
      expect(t.mgr.sendText(v.id, 'hello', { auto: true })).toEqual({ sent: true })
      expect(t.procs[0]!.proc.written[0]).toBe('\x1b[200~hello\x1b[201~')
      await new Promise((r) => setTimeout(r, 250))
      expect(t.procs[0]!.proc.written[1]).toBe('\r')
    })
    it('never types into a permission menu or question, even manually, unless forced', async () => {
      const t = setup()
      const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
      t.mgr.emit(v.id, { type: 'PERMISSION_REQUESTED', payload: { tool: 'Bash', summary: 'ls' } })
      expect(t.mgr.sendText(v.id, 'yes', { auto: false })).toEqual({ sent: false, reason: 'prompt-active' })
      expect(t.mgr.sendText(v.id, 'yes', { auto: true })).toEqual({ sent: false, reason: 'prompt-active' })
      expect(t.procs[0]!.proc.written).toEqual([])
    })
    it('auto-submit only from IDLE', async () => {
      const t = setup()
      const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
      t.mgr.emit(v.id, { type: 'USER_PROMPT_SUBMITTED', payload: { prompt: '' } }) // WORKING
      expect(t.mgr.sendText(v.id, 'x', { auto: true })).toEqual({ sent: false, reason: 'not-idle' })
      expect(t.mgr.sendText(v.id, 'x', { auto: false }).sent).toBe(true) // manual send to a working agent queues the message
    })
    it('strips escape characters so a transcript cannot break out of the paste', async () => {
      const t = setup()
      const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
      t.mgr.emit(v.id, { type: 'SESSION_STARTED', payload: {} })
      t.mgr.sendText(v.id, 'a\x1b[201~rm -rf', { auto: false })
      expect(t.procs[0]!.proc.written[0]).toBe('\x1b[200~a[201~rm -rf\x1b[201~')
    })
  })

  it('survives a database failure: persistence errors are reported, terminals keep running', async () => {
    const t = setup()
    const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
    t.repo.touch = async () => { throw new Error('ECONNREFUSED') }
    t.mgr.emit(v.id, { type: 'USER_PROMPT_SUBMITTED', payload: { prompt: 'x' } })
    await new Promise((r) => setTimeout(r, 20))
    expect(t.persistenceErrors[0]).toMatch(/Terminals keep running/)
    expect(t.mgr.isRunning(v.id)).toBe(true)
  })

  it('archiving a running session stops it first', async () => {
    const t = setup()
    const v = await t.mgr.create({ agentType: 'claude', title: 'A', workingDirectory: dir() })
    await t.mgr.archive(v.id, true)
    expect(t.mgr.isRunning(v.id)).toBe(false)
    expect(t.mgr.getRecord(v.id)!.archivedAt).not.toBeNull()
  })
})

describe('PtyManager', () => {
  it('refuses a second spawn for the same id, replays scrollback, and kills gracefully', async () => {
    const procs: FakePty[] = []
    const exits: string[] = []
    const pty = new PtyManager(() => { const p = new FakePty(); procs.push(p); return p }, { onData: () => undefined, onExit: (id) => exits.push(id) })
    const spec: SpawnSpec = { file: 'x', args: [], cwd: '/', env: {}, cols: 80, rows: 24 }
    pty.spawn('a', spec)
    expect(() => pty.spawn('a', spec)).toThrow()
    procs[0]!.emit('hello'); procs[0]!.emit(' world')
    expect(pty.scrollback('a')).toBe('hello world')
    await pty.kill('a')
    expect(procs[0]!.killed[0]).toBe('SIGHUP')
    expect(exits).toEqual(['a'])
    expect(pty.has('a')).toBe(false)
  })
})
