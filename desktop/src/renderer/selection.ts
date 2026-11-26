/** Growing and shrinking a terminal selection with Shift + arrows, Home and End. Positions are cells counted from the start of the buffer. */
export interface Cells { anchor: number; focus: number } // the fixed end and the end the keys move
const MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const
export type MoveKey = (typeof MOVE_KEYS)[number]
export const isMoveKey = (key: string): key is MoveKey => (MOVE_KEYS as readonly string[]).includes(key)

/** Line the moving end is on. A right-hand end sits just after its last cell, so a full line stays on that line. */
export const focusRow = ({ anchor, focus }: Cells, cols: number): number => Math.floor((focus > anchor ? focus - 1 : focus) / cols)

export function moveSelection(cur: Cells, key: MoveKey, cols: number, rows: number): Cells {
  if (key === 'Home' || key === 'End') {
    const focus = (focusRow(cur, cols) + (key === 'End' ? 1 : 0)) * cols
    return focus === cur.anchor ? cur : { anchor: cur.anchor, focus }
  }
  const step = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : cols
  const limit = (n: number) => Math.min(cols * rows, Math.max(0, n))
  let focus = limit(cur.focus + step)
  if (focus === cur.anchor) focus = limit(focus + step) // never an empty selection: cross over to the other side of the anchor
  return focus === cur.anchor ? cur : { anchor: cur.anchor, focus }
}
