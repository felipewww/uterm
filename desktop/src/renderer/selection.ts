/** Growing and shrinking a terminal selection with Shift + arrows. Positions are cells counted from the start of the buffer. */
export interface Cells { anchor: number; focus: number } // the fixed end and the end the arrows move
export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
export const isArrow = (key: string): key is ArrowKey => key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown'

export function moveSelection(cur: Cells, key: ArrowKey, cols: number, rows: number): Cells {
  const step = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : cols
  const limit = (n: number) => Math.min(cols * rows, Math.max(0, n))
  let focus = limit(cur.focus + step)
  if (focus === cur.anchor) focus = limit(focus + step) // never an empty selection: cross over to the other side of the anchor
  return focus === cur.anchor ? cur : { anchor: cur.anchor, focus }
}
