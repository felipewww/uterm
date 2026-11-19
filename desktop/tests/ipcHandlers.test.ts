import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Electron throws "Attempted to register a second handler" at startup, which unit tests of the managers never see.
describe('main process IPC registration', () => {
  it('registers every ipcMain.handle channel exactly once', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const channels = [...src.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]!)
    expect(channels.length).toBeGreaterThan(20)
    const dupes = channels.filter((c, i) => channels.indexOf(c) !== i)
    expect(dupes).toEqual([])
  })
})
