/**
 * Links broken over several lines. Programs that lay out their own text (Claude Code, Codex, Kiro) wrap a long address with real line
 * breaks and an indent, so xterm sees unrelated lines and links only the first piece. This joins the pieces again for clicking.
 * Only the display is read, and only to find addresses.
 */
export interface Row { text: string; wrapped: boolean }
export interface Piece { row: number; start: number; length: number }
export interface WrappedLink { url: string; pieces: Piece[] }

const CHARS = '[^\\s"\'<>`│|]'
/** How close to the right edge a line must end to count as "the program ran out of room here". */
const SLACK = 4

/** The link covering `row` that continues over more than one line (single-line links are left to the normal link addon). */
export function wrappedLinksAt(rows: (i: number) => Row | undefined, row: number, cols: number): WrappedLink[] {
  const found: WrappedLink[] = []
  for (let first = Math.max(0, row - 20); first <= row; first++) {
    const line = rows(first)
    if (!line) continue
    for (const m of line.text.matchAll(new RegExp(`https?://${CHARS}*`, 'g'))) {
      const link = follow(rows, first, m.index, m[0], cols)
      if (link && link.pieces.some((p) => p.row === row)) found.push(link)
    }
  }
  return found
}

function follow(rows: (i: number) => Row | undefined, first: number, col: number, head: string, cols: number): WrappedLink | null {
  const pieces: Piece[] = [{ row: first, start: col, length: head.length }]
  let url = head
  for (let i = first; ; i++) {
    const cur = rows(i)!; const next = rows(i + 1)
    const last = pieces[pieces.length - 1]!
    const end = cur.text.trimEnd().length
    if (!next || last.start + last.length < end) break // the address stopped before the end of its line
    if (!next.wrapped && end < cols - SLACK) break // there was room left: a normal line break
    const indent = next.text.length - next.text.trimStart().length
    const token = new RegExp(`^${CHARS}+`).exec(next.text.slice(indent))?.[0]
    if (!token || /^https?:\/\//.test(token)) break
    // "Then we ..." after a full line is prose, not the rest of the address
    if (!next.wrapped && /^[A-Za-z]+[,.:;!?]?$/.test(token) && next.text.trim() !== token) break
    pieces.push({ row: i + 1, start: indent, length: token.length })
    url += token
  }
  // punctuation that closes the sentence is not part of the address
  const trail = /[.,;:!?)\]}]+$/.exec(url)?.[0].length ?? 0
  if (trail) { url = url.slice(0, -trail); const p = pieces[pieces.length - 1]!; p.length -= trail; if (p.length <= 0) pieces.pop() }
  return pieces.length > 1 ? { url, pieces } : null
}
