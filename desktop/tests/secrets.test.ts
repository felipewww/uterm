import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretStore, type Crypto } from '../src/main/secrets'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'uterm-secrets-')); dirs.push(d); return join(d, 'secrets.json') }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) }) // d is the test's own mkdtemp folder

// a fake "OS encryption": reversible, but the stored text is visibly not the key
const fake = (available = true, shouldReEncrypt = false): Crypto => ({
  available: async () => available,
  encrypt: async (t) => Buffer.from(`enc:${t.split('').reverse().join('')}`),
  decrypt: async (b) => ({ result: b.toString().replace(/^(enc|old):/, '').split('').reverse().join(''), shouldReEncrypt })
})
const open = async (file: string, crypto = fake()) => { const s = new SecretStore(file, crypto); await s.load(); return s }

describe('SecretStore', () => {
  it('keeps keys encrypted on disk, readable only through get(), and across restarts', async () => {
    const file = tmp()
    const a = await open(file)
    expect(await a.set('openai', '  sk-secret-123 ')).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('sk-secret-123')
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600')
    const b = await open(file)
    expect(b.get('openai')).toBe('sk-secret-123')
    expect(b.has('gemini')).toBe(false)
  })
  it('removes a key, and an empty value removes it too', async () => {
    const file = tmp(); const s = await open(file)
    await s.set('gemini', 'g-key'); s.remove('gemini')
    expect((await open(file)).has('gemini')).toBe(false)
    await s.set('openai', 'k'); await s.set('openai', '   ')
    expect(s.has('openai')).toBe(false)
  })
  it('without OS encryption nothing is written to disk and the key lasts for the session only', async () => {
    const file = tmp(); const s = await open(file, fake(false))
    expect(s.persistent()).toBe(false)
    expect(await s.set('openai', 'sk-memory-only')).toBe(false)
    expect(s.get('openai')).toBe('sk-memory-only')
    expect(() => readFileSync(file, 'utf8')).toThrow()
    expect((await open(file, fake(false))).get('openai')).toBeNull()
  })
  it('writes a key again when the system asks for it', async () => {
    const file = tmp(); writeFileSync(file, JSON.stringify({ openai: Buffer.from('old:k-s').toString('base64') }))
    expect((await open(file, fake(true, true))).get('openai')).toBe('s-k')
    expect(Buffer.from((JSON.parse(readFileSync(file, 'utf8')) as { openai: string }).openai, 'base64').toString()).toBe('enc:k-s')
  })
  it('an undecryptable value means "no key" and is left on disk', async () => {
    const file = tmp(); await (await open(file)).set('openai', 'k')
    const before = readFileSync(file, 'utf8')
    const bad: Crypto = { ...fake(), decrypt: async () => { throw new Error('keyring changed') } }
    expect((await open(file, bad)).get('openai')).toBeNull()
    expect(readFileSync(file, 'utf8')).toBe(before)
  })
})
