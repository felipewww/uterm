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

export interface RecordingKeyInput {
  recording: boolean
  key: string
  ctrl: boolean; shift: boolean; alt: boolean; meta: boolean
  repeat: boolean
  /** an input method (IME) is composing text: Enter/Escape belong to the composition */
  composing: boolean
  /** the key target is a real text field (not the terminal's hidden input) */
  editable: boolean
  /** a dialog is open: its keys belong to it */
  modalOpen: boolean
}

/**
 * Keys that control a recording in progress: a plain Enter finishes it, a plain Escape discards it. They are taken before they can
 * reach whatever has focus (usually the terminal, where Enter would submit the CLI's prompt and Escape would interrupt the agent).
 * Modified keys (Ctrl+Enter sends a draft, Shift+Enter is a newline), held keys, IME composition, text fields and open dialogs are left alone.
 */
export function recordingKeyAction(i: RecordingKeyInput): 'stop' | 'discard' | null {
  if (!i.recording || i.ctrl || i.shift || i.alt || i.meta || i.repeat || i.composing || i.editable || i.modalOpen) return null
  return i.key === 'Enter' ? 'stop' : i.key === 'Escape' ? 'discard' : null
}

/** A text field the user is typing in. The terminal's own hidden textarea does not count. */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.closest) return false
  if (el.classList?.contains('xterm-helper-textarea')) return false
  return !!el.closest('input, textarea, select, [contenteditable="true"]')
}
