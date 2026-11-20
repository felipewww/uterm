import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readOpenTabs, writeOpenTabs } from '../src/main/openTabs'

describe('open tabs memory', () => {
  it('round-trips ids and survives a missing or corrupt file', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'tabs-')), 'open-tabs.json')
    expect(readOpenTabs(f)).toEqual([])
    writeOpenTabs(f, ['a', 'b'])
    expect(readOpenTabs(f)).toEqual(['a', 'b'])
    writeFileSync(f, '{nope'); expect(readOpenTabs(f)).toEqual([])
    writeFileSync(f, JSON.stringify(['a', 3, null, 'c'])); expect(readOpenTabs(f)).toEqual(['a', 'c'])
  })
})
