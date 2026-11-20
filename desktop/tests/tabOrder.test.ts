import { describe, expect, it } from 'vitest'
import { applyOrder, moveTab , groupTabs } from '../src/renderer/tabOrder'

const t = (...ids: string[]) => ids.map((id) => ({ id }))

describe('tab order', () => {
  it('moves a tab before or after another', () => {
    expect(moveTab(['a', 'b', 'c', 'd'], 'a', 'c', false)).toEqual(['b', 'a', 'c', 'd'])
    expect(moveTab(['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveTab(['a', 'b', 'c', 'd'], 'd', 'a', false)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveTab(['a', 'b', 'c'], 'c', 'b', true)).toEqual(['a', 'b', 'c']) // already there
  })
  it('ignores impossible moves', () => {
    expect(moveTab(['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b'])
    expect(moveTab(['a', 'b'], 'x', 'a', true)).toEqual(['a', 'b'])
    expect(moveTab(['a', 'b'], 'a', 'x', false)).toEqual(['a', 'b'])
  })
  it('applies a saved order: known tabs keep their place, new ones go last, closed ones vanish', () => {
    expect(applyOrder(t('a', 'b', 'c'), ['c', 'a', 'gone', 'b']).map((x) => x.id)).toEqual(['c', 'a', 'b'])
    expect(applyOrder(t('a', 'b', 'n1', 'n2'), ['b', 'a']).map((x) => x.id)).toEqual(['b', 'a', 'n1', 'n2'])
    expect(applyOrder(t('a', 'b'), []).map((x) => x.id)).toEqual(['a', 'b'])
  })
})

describe('groupTabs', () => {
  it('gathers a folder’s tabs at its first tab and leaves loose tabs alone', () => {
    const t = (id: string, g: string | null) => ({ id, g })
    const out = groupTabs([t('a', 'F'), t('b', null), t('c', 'F'), t('d', 'G')], (x) => x.g)
    expect(out.map((x) => [x.group, x.tabs.map((y) => y.id)])).toEqual([['F', ['a', 'c']], [null, ['b']], ['G', ['d']]])
  })
})
