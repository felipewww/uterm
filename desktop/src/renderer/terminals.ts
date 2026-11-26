import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { matchesShortcut } from './shortcut'
import { wrappedLinksAt } from './wrappedLinks'
import { onThemeChange, terminalTheme } from './design/theme'
import { store } from './store'

interface Entry { term: Terminal; fit: FitAddon; el: HTMLDivElement; opened: boolean; observer?: ResizeObserver }
const entries = new Map<string, Entry>()

function openLink(uri: string): void { void window.echo.openUrl({ url: uri }).catch(() => undefined) }

export function ensureTerminal(id: string): Entry {
  const existing = entries.get(id)
  if (existing) return existing
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', 'DejaVu Sans Mono', Menlo, monospace", fontSize: 14, scrollback: 10000,
    cursorBlink: true, allowProposedApi: true, theme: terminalTheme(), macOptionIsMeta: true,
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
