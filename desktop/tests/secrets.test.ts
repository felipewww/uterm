import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretStore, type Crypto } from '../src/main/secrets'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'uterm-secrets-')); dirs.push(d); return join(d, 'secrets.json') }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) }) // d is the test's own mkdtemp folder

// a fake "OS encryption": reversible, but the stored text is visibly not the key
const fake = (available = true): Crypto => ({
  available: () => available,
  encrypt: (t) => Buffer.from(`enc:${t.split('').reverse().join('')}`),
  decrypt: (b) => b.toString().replace(/^enc:/, '').split('').reverse().join('')
})

describe('SecretStore', () => {
  it('keeps keys encrypted on disk, readable only through get(), and across restarts', () => {
    const file = tmp()
    const a = new SecretStore(file, fake())
    expect(a.set('openai', '  sk-secret-123 ')).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('sk-secret-123')
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600')
    const b = new SecretStore(file, fake())
    expect(b.get('openai')).toBe('sk-secret-123')
    expect(b.has('gemini')).toBe(false)
  })
  it('removes a key, and an empty value removes it too', () => {
    const file = tmp(); const s = new SecretStore(file, fake())
    s.set('gemini', 'g-key'); s.remove('gemini')
    expect(new SecretStore(file, fake()).has('gemini')).toBe(false)
    s.set('openai', 'k'); s.set('openai', '   ')
    expect(s.has('openai')).toBe(false)
  })
  it('without OS encryption nothing is written to disk and the key lasts for the session only', () => {
    const file = tmp(); const s = new SecretStore(file, fake(false))
    expect(s.persistent()).toBe(false)
    expect(s.set('openai', 'sk-memory-only')).toBe(false)
    expect(s.get('openai')).toBe('sk-memory-only')
    expect(() => readFileSync(file, 'utf8')).toThrow()
    expect(new SecretStore(file, fake(false)).get('openai')).toBeNull()
  })
  it('a corrupt file or an undecryptable value just means "no key"', () => {
    const file = tmp(); new SecretStore(file, fake()).set('openai', 'k')
    const bad: Crypto = { ...fake(), decrypt: () => { throw new Error('keyring changed') } }
    expect(new SecretStore(file, bad).get('openai')).toBeNull()
  })
})
