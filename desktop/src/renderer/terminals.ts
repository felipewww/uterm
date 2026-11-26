import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { matchesShortcut } from './shortcut'
import { wrappedLinksAt } from './wrappedLinks'
import { isArrow, moveSelection, type ArrowKey, type Cells } from './selection'
import { onThemeChange, terminalTheme } from './design/theme'
import { store } from './store'

interface Entry { term: Terminal; fit: FitAddon; el: HTMLDivElement; opened: boolean; observer?: ResizeObserver }
const entries = new Map<string, Entry>()

function openLink(uri: string): void { void window.echo.openUrl({ url: uri }).catch(() => undefined) }

/** Which end of each selection the arrows move; forgotten as soon as the selection is made some other way (mouse). */
const keyboardEnds = new WeakMap<Terminal, Cells>()
function extendSelection(term: Terminal, key: ArrowKey): void {
  const at = term.getSelectionPosition()
  if (!at) return
  const { cols } = term
  const from = at.start.y * cols + at.start.x
  const to = at.end.y * cols + at.end.x
  const kept = keyboardEnds.get(term)
  const cur = kept && Math.min(kept.anchor, kept.focus) === from && Math.max(kept.anchor, kept.focus) === to ? kept : { anchor: from, focus: to }
  const next = moveSelection(cur, key, cols, term.buffer.active.length)
  keyboardEnds.set(term, next)
  const start = Math.min(next.anchor, next.focus)
  term.select(start % cols, Math.floor(start / cols), Math.abs(next.focus - next.anchor))
  const row = Math.min(term.buffer.active.length - 1, Math.floor(next.focus / cols))
  const top = term.buffer.active.viewportY
  if (row < top) term.scrollLines(row - top)
  else if (row >= top + term.rows) term.scrollLines(row - top - term.rows + 1)
}

export const hasSelection = (id: string): boolean => !!entries.get(id)?.term.hasSelection()
export function copySelection(id: string): void {
  const text = entries.get(id)?.term.getSelection()
  if (text) void window.echo.clipboard.write({ text })
}
export function pasteInto(id: string): void {
  void window.echo.clipboard.read().then((t: string) => { if (t) entries.get(id)?.term.paste(t) })
}
export function selectAllIn(id: string): void { entries.get(id)?.term.selectAll() }

export function ensureTerminal(id: string): Entry {
  const existing = entries.get(id)
  if (existing) return existing
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', Menlo, monospace", fontSize: 14, scrollback: 10000,
    cursorBlink: true, allowProposedApi: true, theme: terminalTheme(), macOptionIsMeta: true,
    rightClickSelectsWord: false, // right click opens the menu on whatever is already selected
    macOptionClickForcesSelection: true, // select even while a program is using the mouse (Shift elsewhere)
    // OSC 8 hyperlinks: xterm's default asks with a browser confirm() and then tries window.open; hand the address to the system browser instead
    linkHandler: { activate: (_e, uri) => openLink(uri), allowNonHttpProtocols: false }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // registered before the addon so that a link broken over lines wins over its first piece
  term.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const buf = term.buffer.active
      const row = (i: number) => { const l = buf.getLine(i); return l ? { text: l.translateToString(true), wrapped: l.isWrapped } : undefined }
      const y = lineNumber - 1
      callback(wrappedLinksAt(row, y, term.cols).map((link) => {
        const piece = link.pieces.find((p) => p.row === y)!
        return { text: link.url, range: { start: { x: piece.start + 1, y: lineNumber }, end: { x: piece.start + piece.length, y: lineNumber } }, activate: (e: MouseEvent) => { if (e.ctrlKey || e.metaKey) openLink(link.url) } }
      }))
    }
  })
  term.loadAddon(new WebLinksAddon((e, uri) => { if (e.ctrlKey || e.metaKey) openLink(uri) })) // plain URLs: Ctrl (Cmd on a Mac) + click
  const el = document.createElement('div')
  el.className = 'term-host'
  el.style.display = 'none'
  term.onData((data) => { void window.echo.pty.write({ id, data }) })
  term.onResize(({ cols, rows }) => { void window.echo.pty.resize({ id, cols, rows }) })
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    if (matchesShortcut(e, store.settings.recordShortcut)) return false // handled by the app, never typed into the agent
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') {
      const sel = term.getSelection()
      if (sel) void window.echo.clipboard.write({ text: sel })
      return false
    }
    // With text selected, Shift + arrows grows or shrinks the selection; with nothing selected the keys go to the program as usual
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && isArrow(e.key) && term.hasSelection()) {
      e.preventDefault()
      extendSelection(term, e.key)
      return false
    }
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') {
      void window.echo.clipboard.read().then((t: string) => { if (t) term.paste(t) })
      return false
    }
    return true
  })
  const entry: Entry = { term, fit, el, opened: false }
  entries.set(id, entry)
  void window.echo.pty.attach({ id }).then((buf: string) => { if (buf) term.write(buf) }) // renderer reload: replay
  return entry
}

/**
 * xterm observes theme changes, but its canvas renderer may retain already painted
 * rows until the next PTY write. Apply the option and explicitly repaint so a
 * palette switch is visibly immediate even when the agent is idle.
 */
function applyTerminalTheme(): void {
  const theme = terminalTheme()
  for (const e of entries.values()) {
    e.term.options.theme = theme
    e.el.style.backgroundColor = theme.background
    e.el.querySelectorAll<HTMLElement>('.xterm-viewport').forEach((viewport) => { viewport.style.backgroundColor = theme.background })
    if (e.opened) e.term.refresh(0, e.term.rows - 1)
  }
}

onThemeChange(applyTerminalTheme)

export function writeTo(id: string, data: string): void { ensureTerminal(id).term.write(data) }

export function showTerminal(container: HTMLElement, id: string | null): { cols: number; rows: number } | null {
  for (const [otherId, e] of entries) if (otherId !== id) e.el.style.display = 'none'
  if (!id) return null
  const e = ensureTerminal(id)
  if (!e.el.parentElement) container.appendChild(e.el)
  e.el.style.display = 'block'
  if (!e.opened) {
    e.term.open(e.el)
    e.opened = true
    e.observer = new ResizeObserver(() => { if (e.el.style.display !== 'none') safeFit(e) })
    e.observer.observe(container)
  }
  safeFit(e)
  e.term.focus()
  return { cols: e.term.cols, rows: e.term.rows }
}

function safeFit(e: Entry): void {
  try { e.fit.fit() } catch { /* container not laid out yet */ }
}

export function focusTerminal(id: string): void { entries.get(id)?.term.focus() }

export function disposeTerminal(id: string): void {
  const e = entries.get(id)
  if (!e) return
  e.observer?.disconnect(); e.term.dispose(); e.el.remove(); entries.delete(id)
}

export function terminalSize(id: string): { cols: number; rows: number } {
  const e = entries.get(id)
  return e ? { cols: e.term.cols, rows: e.term.rows } : { cols: 100, rows: 30 }
}
