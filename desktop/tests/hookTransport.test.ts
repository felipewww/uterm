import { spawnSync } from 'node:child_process'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { HookServer } from '../src/main/hooks/hookServer'
import type { HookEnvelope } from '../src/main/hooks/schemas'

const script = resolve(__dirname, '..', '..', 'hooks', 'claude', 'hook.mjs')
const codexScript = resolve(__dirname, '..', '..', 'hooks', 'codex', 'hook.mjs')
let server: HookServer | undefined
afterEach(async () => { await server?.stop(); server = undefined })

function runHook(file: string, env: Record<string, string>, payload: unknown) {
  const t0 = Date.now()
  const r = spawnSync('node', [file], { input: JSON.stringify(payload), env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 5000 })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0 }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('hook transport (real Unix socket + real hook script)', () => {
  it('delivers a managed event with agent, session key and monotonic seq; socket is owner-only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-hook-'))
    const sock = join(dir, 'run', 'hooks.sock')
    const got: HookEnvelope[] = []
    server = new HookServer(sock, (e) => got.push(e))
    await server.start()
    expect(statSync(sock).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'run')).mode & 0o777).toBe(0o700)
    const key = crypto.randomUUID()
    const r = runHook(script, { ECHO_TERM_SESSION_ID: key, ECHO_TERM_AGENT: 'claude', ECHO_TERM_SOCKET: sock }, { hook_event_name: 'Stop', session_id: 'n1' })
    expect(r.status).toBe(0); expect(r.stdout).toBe('') // never interferes with the agent
    await wait(100)
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ v: 1, agent: 'claude', sessionKey: key, payload: { hook_event_name: 'Stop' } })
    expect(typeof got[0]!.seq).toBe('number')
  })

  it('codex wrapper tags the agent as codex', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-hook-'))
    const sock = join(dir, 'hooks.sock')
    const got: HookEnvelope[] = []
    server = new HookServer(sock, (e) => got.push(e))
    await server.start()
    runHook(codexScript, { ECHO_TERM_SESSION_ID: crypto.randomUUID(), ECHO_TERM_AGENT: 'codex', ECHO_TERM_SOCKET: sock }, { hook_event_name: 'SessionStart', session_id: 'c1' })
    await wait(100)
    expect(got[0]?.agent).toBe('codex')
  })

  it('exits 0 silently and fast when the app is not running', () => {
    const r = runHook(script, { ECHO_TERM_SESSION_ID: crypto.randomUUID(), ECHO_TERM_SOCKET: '/tmp/definitely-no-socket-here.sock' }, { hook_event_name: 'Stop' })
    expect(r.status).toBe(0); expect(r.stdout).toBe(''); expect(r.stderr).toBe('')
    expect(r.ms).toBeLessThan(2000)
  })

  it('ignores unmanaged agents (no session key) without touching the socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-hook-'))
    const sock = join(dir, 'hooks.sock')
    const got: HookEnvelope[] = []
    server = new HookServer(sock, (e) => got.push(e))
    await server.start()
    const r = runHook(script, { ECHO_TERM_SOCKET: sock }, { hook_event_name: 'Stop' })
    expect(r.status).toBe(0)
    await wait(100)
    expect(got).toEqual([])
  })

  it('drops malformed, oversized and unauthenticated-shape lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'echo-hook-'))
    const sock = join(dir, 'hooks.sock')
    const got: HookEnvelope[] = []
    server = new HookServer(sock, (e) => got.push(e))
    await server.start()
    const send = (data: string) => new Promise<void>((res) => { const c = net.createConnection(sock, () => c.end(data, () => res())); c.on('error', () => res()) })
    await send('not json\n')
    await send(JSON.stringify({ v: 2, agent: 'claude', sessionKey: crypto.randomUUID(), payload: {} }) + '\n')
    await send(JSON.stringify({ v: 1, agent: 'claude', sessionKey: 'not-a-uuid', payload: {} }) + '\n')
    await send('x'.repeat(1_200_000))
    await send(JSON.stringify({ v: 1, agent: 'claude', sessionKey: crypto.randomUUID(), payload: { ok: 1 } }) + '\n')
    await wait(150)
    expect(got).toHaveLength(1)
  })
})
