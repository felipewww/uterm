import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexAdapter, hasOwnDeveloperInstructions } from '../src/main/agents/codex'
import { SPEECH_INSTRUCTIONS } from '../src/main/speechInstructions'

const input = (over: Partial<Parameters<CodexAdapter['buildLaunch']>[0]> = {}) => ({
  sessionKey: 'k', nativeSessionId: null, workingDirectory: '/tmp', socketPath: '/tmp/s.sock', instructions: SPEECH_INSTRUCTIONS, ...over
})
const home = (config?: string) => { const d = mkdtempSync(join(tmpdir(), 'codex-home-')); if (config !== undefined) writeFileSync(join(d, 'config.toml'), config); return d }
const saved = process.env.CODEX_HOME
afterEach(() => { if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved })

describe('Codex launch', () => {
  it('passes the speech instructions per process with -c, before the subcommand', async () => {
    process.env.CODEX_HOME = home()
    const fresh = await new CodexAdapter().buildLaunch(input())
    expect(fresh.args[0]).toBe('-c')
    expect(fresh.args[1]!.startsWith('developer_instructions="')).toBe(true)
    expect(fresh.args[2]).toBe('--no-alt-screen')
    expect(JSON.parse(fresh.args[1]!.slice('developer_instructions='.length))).toBe(SPEECH_INSTRUCTIONS) // a valid, lossless string literal
    const resumed = await new CodexAdapter().buildLaunch(input({ nativeSessionId: 'abc-123' }))
    expect(resumed.args.slice(2)).toEqual(['--no-alt-screen', 'resume', 'abc-123'])
  })
  it('always runs inline (no alternate screen) and adds nothing else when speech instructions are off', async () => {
    process.env.CODEX_HOME = home()
    expect((await new CodexAdapter().buildLaunch(input({ instructions: null }))).args).toEqual(['--no-alt-screen'])
  })
  it("does not override developer_instructions the user already set in config.toml", async () => {
    process.env.CODEX_HOME = home('model = "x"\ndeveloper_instructions = "be terse"\n')
    expect(hasOwnDeveloperInstructions()).toBe(true)
    expect((await new CodexAdapter().buildLaunch(input())).args).toEqual(['--no-alt-screen'])
  })
})
