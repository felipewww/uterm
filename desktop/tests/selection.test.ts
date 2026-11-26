import { describe, expect, it } from 'vitest'
import { moveSelection } from '../src/renderer/selection'

describe('keyboard selection', () => {
  it('moves the free end by a cell or a line', () => {
    expect(moveSelection({ anchor: 10, focus: 15 }, 'ArrowRight', 80, 100)).toEqual({ anchor: 10, focus: 16 })
    expect(moveSelection({ anchor: 10, focus: 15 }, 'ArrowLeft', 80, 100)).toEqual({ anchor: 10, focus: 14 })
    expect(moveSelection({ anchor: 10, focus: 15 }, 'ArrowDown', 80, 100)).toEqual({ anchor: 10, focus: 95 })
  })
  it('crosses the anchor instead of leaving nothing selected', () => {
    expect(moveSelection({ anchor: 10, focus: 11 }, 'ArrowLeft', 80, 100)).toEqual({ anchor: 10, focus: 9 })
  })
  it('jumps to the start or end of the line with Home and End', () => {
    expect(moveSelection({ anchor: 90, focus: 95 }, 'Home', 80, 100)).toEqual({ anchor: 90, focus: 80 })
    expect(moveSelection({ anchor: 90, focus: 95 }, 'End', 80, 100)).toEqual({ anchor: 90, focus: 160 })
    expect(moveSelection({ anchor: 90, focus: 160 }, 'End', 80, 100)).toEqual({ anchor: 90, focus: 160 }) // already there: same line
    expect(moveSelection({ anchor: 90, focus: 160 }, 'Home', 80, 100)).toEqual({ anchor: 90, focus: 80 })
  })
  it('keeps the selection when Home or End would empty it', () => {
    expect(moveSelection({ anchor: 80, focus: 85 }, 'Home', 80, 100)).toEqual({ anchor: 80, focus: 85 })
  })
  it('stays inside the buffer', () => {
    expect(moveSelection({ anchor: 3, focus: 0 }, 'ArrowUp', 80, 100)).toEqual({ anchor: 3, focus: 0 })
    expect(moveSelection({ anchor: 0, focus: 8000 }, 'ArrowRight', 80, 100)).toEqual({ anchor: 0, focus: 8000 })
  })
})
