import { describe, expect, it } from 'vitest'
import { wrappedLinksAt, type Row } from '../src/renderer/wrappedLinks'

const screen = (lines: string[], wrapped: number[] = []) => (i: number): Row | undefined => (i >= 0 && i < lines.length ? { text: lines[i]!, wrapped: wrapped.includes(i) } : undefined)

describe('links broken over lines', () => {
  const lines = ['  Open it here:', '  https://example.com/a/very/lon', '  g/path?query=1&other=abcdefghi', '  jk', '']
  const url = 'https://example.com/a/very/long/path?query=1&other=abcdefghijk'

  it('joins the pieces, from whichever line is pointed at', () => {
    for (const row of [1, 2, 3]) expect(wrappedLinksAt(screen(lines), row, 32)[0]?.url).toBe(url)
    expect(wrappedLinksAt(screen(lines), 2, 32)[0]!.pieces).toEqual([{ row: 1, start: 2, length: 30 }, { row: 2, start: 2, length: 30 }, { row: 3, start: 2, length: 2 }])
    expect(wrappedLinksAt(screen(lines), 0, 32)).toEqual([])
  })
  it('does not glue the next sentence to an address that filled its line', () => {
    expect(wrappedLinksAt(screen(['see https://example.com/abcdefg', 'Then we can continue.']), 0, 32)).toEqual([])
  })
  it('does not join when the line had room left, or when another address starts', () => {
    expect(wrappedLinksAt(screen(['https://example.com/a', 'next/thing']), 0, 80)).toEqual([])
    expect(wrappedLinksAt(screen(['https://example.com/abcdefghij', 'https://example.org/x']), 0, 32)).toEqual([])
  })
  it('handles the wrap done by the terminal and drops closing punctuation', () => {
    const l = wrappedLinksAt(screen(['(https://example.com/abc', 'def/page.html).'], [1]), 1, 24)
    expect(l[0]?.url).toBe('https://example.com/abcdef/page.html')
  })
})
