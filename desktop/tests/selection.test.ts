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
  it('stays inside the buffer', () => {
    expect(moveSelection({ anchor: 3, focus: 0 }, 'ArrowUp', 80, 100)).toEqual({ anchor: 3, focus: 0 })
    expect(moveSelection({ anchor: 0, focus: 8000 }, 'ArrowRight', 80, 100)).toEqual({ anchor: 0, focus: 8000 })
  })
})
