import { describe, expect, it } from 'vitest'
import { recordingKeyAction, type RecordingKeyInput } from '../src/renderer/shortcut'

const base: RecordingKeyInput = { recording: true, key: 'Enter', ctrl: false, shift: false, alt: false, meta: false, repeat: false, composing: false, editable: false, modalOpen: false }

describe('keys that control a recording', () => {
  it('a plain Enter finishes it and a plain Escape discards it', () => {
    expect(recordingKeyAction(base)).toBe('stop')
    expect(recordingKeyAction({ ...base, key: 'Escape' })).toBe('discard')
  })
  it('does nothing when not recording, or for other keys', () => {
    expect(recordingKeyAction({ ...base, recording: false })).toBeNull()
    expect(recordingKeyAction({ ...base, recording: false, key: 'Escape' })).toBeNull()
    expect(recordingKeyAction({ ...base, key: ' ' })).toBeNull()
    expect(recordingKeyAction({ ...base, key: 'a' })).toBeNull()
  })
  it('leaves modified keys alone (Ctrl+Enter sends a draft, Shift+Enter is a newline)', () => {
    for (const m of ['ctrl', 'shift', 'alt', 'meta'] as const) { expect(recordingKeyAction({ ...base, [m]: true }), m).toBeNull(); expect(recordingKeyAction({ ...base, key: 'Escape', [m]: true }), m).toBeNull() }
  })
  it('leaves held keys, IME composition, text fields and dialogs alone', () => {
    for (const k of ['Enter', 'Escape']) {
      expect(recordingKeyAction({ ...base, key: k, repeat: true })).toBeNull()
      expect(recordingKeyAction({ ...base, key: k, composing: true })).toBeNull()
      expect(recordingKeyAction({ ...base, key: k, editable: true })).toBeNull()
      expect(recordingKeyAction({ ...base, key: k, modalOpen: true })).toBeNull()
    }
  })
})

import { isSendCombo, prettyShortcut } from '../src/renderer/shortcut'
describe('platform shortcuts', () => {
  it('writes shortcuts the way the platform does', () => {
    expect(prettyShortcut('Meta+Shift+Space', true)).toBe('⌘ ⇧ Space')
    expect(prettyShortcut('Control+Shift+Space', false)).toBe('Ctrl + Shift + Space')
  })
  it('Cmd+Enter sends on a Mac, Ctrl+Enter elsewhere, never with other modifiers', () => {
    const k = (o: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o })
    expect(isSendCombo(k({ metaKey: true }), true)).toBe(true)
    expect(isSendCombo(k({ ctrlKey: true }), true)).toBe(false)
    expect(isSendCombo(k({ ctrlKey: true }), false)).toBe(true)
    expect(isSendCombo(k({ metaKey: true, shiftKey: true }), true)).toBe(false)
    expect(isSendCombo(k({ metaKey: true, key: 'a' }), true)).toBe(false)
  })
})
