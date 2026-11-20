/** Manual order of the terminal tabs (drag and drop). Pure helpers so the rules are testable. */

/** Moves `id` next to `targetId` (before it, or after when `after`). Unknown ids are ignored. */
export function moveTab(order: string[], id: string, targetId: string, after: boolean): string[] {
  if (id === targetId || !order.includes(id) || !order.includes(targetId)) return order
  const rest = order.filter((x) => x !== id)
  const i = rest.indexOf(targetId)
  rest.splice(after ? i + 1 : i, 0, id)
  return rest
}

/** Applies a saved order to the tabs that exist: known ids keep their place, new ones go last (in their natural order), gone ones vanish. */
export function applyOrder<T extends { id: string }>(items: T[], saved: string[]): T[] {
  const rank = new Map(saved.map((id, i) => [id, i]))
  const known = items.filter((t) => rank.has(t.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...known, ...items.filter((t) => !rank.has(t.id))]
}

/** Gathers tabs of the same group next to each other, at the place of the group's first tab. Ungrouped tabs (null) stay where they are. */
export function groupTabs<T extends { id: string }>(items: T[], groupOf: (t: T) => string | null): Array<{ group: string | null; tabs: T[] }> {
  const out: Array<{ group: string | null; tabs: T[] }> = []
  const at = new Map<string, number>()
  for (const t of items) {
    const g = groupOf(t)
    if (g === null) { out.push({ group: null, tabs: [t] }); continue }
    const i = at.get(g)
    if (i === undefined) { at.set(g, out.length); out.push({ group: g, tabs: [t] }) } else out[i]!.tabs.push(t)
  }
  return out
}
