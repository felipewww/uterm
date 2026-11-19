/** "Control+Shift+Space" style shortcut matching. */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map((p) => p.trim()).filter(Boolean)
  const key = parts.pop()
  if (!key) return false
  const want = new Set(parts.map((p) => p.toLowerCase()))
  if (want.has('control') !== e.ctrlKey || want.has('shift') !== e.shiftKey || want.has('alt') !== e.altKey || want.has('meta') !== e.metaKey) return false
  const k = e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return k.toLowerCase() === key.toLowerCase()
}

export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean) as string[]
  if (mods.length === 0) return null // require a modifier so normal typing is never captured
  const key = e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  return [...mods, key].join('+')
}
