import { describe, expect, it } from 'vitest'
import { innerCommand, macScript, shq, terminalArgv } from '../src/main/externalTerminal'

describe('open in system terminal', () => {
  it('quotes safely', () => { expect(shq("a'b; rm -rf /")).toBe(`'a'\\''b; rm -rf /'`) })
  it('resumes each agent’s own conversation, and nothing for a plain shell', () => {
    expect(innerCommand({ agent: 'claude', nativeSessionId: 'abc', configDir: null })).toBe("claude --resume 'abc'")
    expect(innerCommand({ agent: 'claude', nativeSessionId: 'abc', configDir: '/h/.claude-me' })).toBe("CLAUDE_CONFIG_DIR='/h/.claude-me' claude --resume 'abc'")
    expect(innerCommand({ agent: 'codex', nativeSessionId: 'x', configDir: null })).toBe("codex resume 'x'")
    expect(innerCommand({ agent: 'kiro', nativeSessionId: null, configDir: null })).toBe('kiro-cli chat')
    expect(innerCommand({ agent: 'shell', nativeSessionId: null, configDir: null })).toBeNull()
  })
  it('builds argv per terminal app, keeping a shell open after the command', () => {
    const g = terminalArgv('gnome-terminal', '/p', "claude --resume 'a'", '/bin/bash')
    expect(g.args).toEqual(['--working-directory=/p', '--', '/bin/bash', '-ic', "claude --resume 'a'; exec '/bin/bash' -i"])
    expect(terminalArgv('kitty', '/p', null, '/bin/bash').args).toEqual(['--directory', '/p'])
    expect(terminalArgv('konsole', '/p', 'ls', '/bin/zsh').args.slice(0, 3)).toEqual(['--workdir', '/p', '-e'])
  })
  it('escapes the macOS script', () => { expect(macScript('/a"b', 'claude')).toContain('\\"') })
})
