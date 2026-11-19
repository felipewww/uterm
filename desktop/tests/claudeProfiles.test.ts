import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeProfiles, profileName } from '../src/main/agents/claudeProfiles'

const home = () => mkdtempSync(join(tmpdir(), 'echo-home-'))

describe('claudeProfiles', () => {
  it('lists the default folder first, then other ~/.claude-* folders that hold conversations', () => {
    const h = home()
    mkdirSync(join(h, '.claude', 'projects'), { recursive: true })
    mkdirSync(join(h, '.claude-me', 'projects'), { recursive: true })
    mkdirSync(join(h, '.claude-empty')) // no conversations: not offered
    mkdirSync(join(h, '.config'))
    const p = claudeProfiles({}, h)
    expect(p.map((x) => x.dir)).toEqual([null, join(h, '.claude-me')])
    expect(p[0]!.resolved).toBe(join(h, '.claude'))
    expect(p[1]!.label).toBe(join(h, '.claude-me').replace(h, '~'))
  })
  it('treats $CLAUDE_CONFIG_DIR as the default and does not list it twice', () => {
    const h = home()
    mkdirSync(join(h, '.claude', 'projects'), { recursive: true })
    mkdirSync(join(h, '.claude-me', 'projects'), { recursive: true })
    const p = claudeProfiles({ CLAUDE_CONFIG_DIR: join(h, '.claude-me') }, h)
    expect(p[0]).toMatchObject({ dir: null, resolved: join(h, '.claude-me') })
    expect(p.map((x) => x.resolved)).toEqual([join(h, '.claude-me'), join(h, '.claude')])
  })
  it('names a profile from its folder', () => {
    expect(profileName('/home/x/.claude-me')).toBe('me')
    expect(profileName('/home/x/.claude')).toBe('.claude')
  })
})
