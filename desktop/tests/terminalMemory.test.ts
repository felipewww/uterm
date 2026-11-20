import { describe, expect, it } from 'vitest'
import { parseLsofCwd } from '../src/main/cwd'
import { MemoryCommandStore } from '../src/main/db/commandStore'

describe('terminal memory', () => {
  it('reads the folder from lsof output', () => {
    expect(parseLsofCwd('p123\nfcwd\nn/home/me/projects/api\n')).toBe('/home/me/projects/api')
    expect(parseLsofCwd('p123\nftxt\nn/usr/bin/bash\n')).toBeNull()
    expect(parseLsofCwd('')).toBeNull()
  })
  it('keeps the commands a user chose, per terminal and in order, and forgets them on request', async () => {
    const s = new MemoryCommandStore()
    const a = await s.add('t1', 'docker-compose up mysql', 'db')
    await s.add('t1', 'npm run start:dev')
    await s.add('t2', 'npm run dev')
    expect((await s.list('t1')).map((c) => c.command)).toEqual(['docker-compose up mysql', 'npm run start:dev'])
    expect((await s.list('t2')).map((c) => c.command)).toEqual(['npm run dev'])
    expect((await s.get(a.id))?.label).toBe('db')
    await s.remove(a.id)
    expect((await s.list('t1')).map((c) => c.command)).toEqual(['npm run start:dev'])
  })
})
