// Theme runtime: picks the active theme (data-theme on <html>) and tells interested code (e.g. xterm) to re-read tokens.
import { ref } from 'vue'

export interface ThemeInfo { id: string; label: string }
export const THEMES: ThemeInfo[] = [
  { id: 'carbon', label: 'Carbon' },
  { id: 'islands-dark', label: 'Islands Dark' },
  { id: 'islands-light', label: 'Islands Light' }
]
export const DEFAULT_THEME = 'carbon'
const KEY = 'echo-term.theme.v2'
const TERMINAL_BACKGROUND_KEY = 'echo-term.terminal-background.v1'

export const currentTheme = ref(DEFAULT_THEME)
export type TerminalBackground = 'original' | 'dark' | 'black'
export const TERMINAL_BACKGROUNDS: Array<{ id: TerminalBackground; label: string }> = [
  { id: 'original', label: 'Original' }, { id: 'dark', label: 'Dark' }, { id: 'black', label: 'Black' }
]
export const currentTerminalBackground = ref<TerminalBackground>('original')

const listeners: Array<() => void> = []
export function onThemeChange(cb: () => void): void { listeners.push(cb) }
const notifyThemeChange = () => listeners.forEach((cb) => cb())

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function setTheme(id: string): void {
  const next = THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME
  currentTheme.value = next
  document.documentElement.dataset.theme = next
  try { localStorage.setItem(KEY, next) } catch { /* storage unavailable */ }
  notifyThemeChange()
}

export function initTheme(): void {
  let saved = DEFAULT_THEME
  try { saved = localStorage.getItem(KEY) ?? DEFAULT_THEME } catch { /* defaults */ }
  setTheme(saved)
}

export function setTerminalBackground(id: string): void {
  const next: TerminalBackground = TERMINAL_BACKGROUNDS.some((background) => background.id === id)
    ? id as TerminalBackground : 'original'
  currentTerminalBackground.value = next
  try { localStorage.setItem(TERMINAL_BACKGROUND_KEY, next) } catch { /* storage unavailable */ }
  notifyThemeChange()
}

export function initTerminalBackground(): void {
  let background = 'original'
  try {
    background = localStorage.getItem(TERMINAL_BACKGROUND_KEY) ?? background
  } catch { /* defaults */ }
  setTerminalBackground(background)
}

export interface XtermTheme {
  background: string
  [key: string]: string
}

/** xterm palette follows the app's terminal colors; background depth is independently selectable. */
export function terminalTheme(): XtermTheme {
  const palette = echoPalette()
  return { ...palette, background: terminalBackground(palette.background) }
}

function echoPalette(): XtermTheme {
  const t = token
  return {
    background: t('--term-bg'), foreground: t('--term-fg'), cursor: t('--term-cursor'), selectionBackground: t('--term-selection'),
    black: t('--ansi-black'), red: t('--ansi-red'), green: t('--ansi-green'), yellow: t('--ansi-yellow'),
    blue: t('--ansi-blue'), magenta: t('--ansi-magenta'), cyan: t('--ansi-cyan'), white: t('--ansi-white'),
    brightBlack: t('--ansi-bright-black'), brightRed: t('--ansi-bright-red'), brightGreen: t('--ansi-bright-green'), brightYellow: t('--ansi-bright-yellow'),
    brightBlue: t('--ansi-bright-blue'), brightMagenta: t('--ansi-bright-magenta'), brightCyan: t('--ansi-bright-cyan'), brightWhite: t('--ansi-bright-white')
  }
}

function terminalBackground(original: string): string {
  if (currentTerminalBackground.value === 'dark') return '#101214'
  if (currentTerminalBackground.value === 'black') return '#070809'
  return original
}
