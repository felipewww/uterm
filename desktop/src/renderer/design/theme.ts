// Theme runtime: picks the active theme (data-theme on <html>) and tells interested code (e.g. xterm) to re-read tokens.
import { ref } from 'vue'

export interface ThemeInfo { id: string; label: string }
export const THEMES: ThemeInfo[] = [
  { id: 'islands-dark', label: 'Islands Dark' },
  { id: 'islands-light', label: 'Islands Light' }
]
export const DEFAULT_THEME = 'islands-dark'
const KEY = 'echo-term.theme'

export const currentTheme = ref(DEFAULT_THEME)
const listeners: Array<() => void> = []
export function onThemeChange(cb: () => void): void { listeners.push(cb) }

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function setTheme(id: string): void {
  const next = THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME
  currentTheme.value = next
  document.documentElement.dataset.theme = next
  try { localStorage.setItem(KEY, next) } catch { /* storage unavailable */ }
  listeners.forEach((cb) => cb())
}

export function initTheme(): void {
  let saved = DEFAULT_THEME
  try { saved = localStorage.getItem(KEY) ?? DEFAULT_THEME } catch { /* defaults */ }
  setTheme(saved)
}

/** xterm theme built from the active theme's --term-* / --ansi-* tokens. */
export function terminalTheme(): Record<string, string> {
  const t = token
  return {
    background: t('--term-bg'), foreground: t('--term-fg'), cursor: t('--term-cursor'), selectionBackground: t('--term-selection'),
    black: t('--ansi-black'), red: t('--ansi-red'), green: t('--ansi-green'), yellow: t('--ansi-yellow'),
    blue: t('--ansi-blue'), magenta: t('--ansi-magenta'), cyan: t('--ansi-cyan'), white: t('--ansi-white'),
    brightBlack: t('--ansi-bright-black'), brightRed: t('--ansi-bright-red'), brightGreen: t('--ansi-bright-green'), brightYellow: t('--ansi-bright-yellow'),
    brightBlue: t('--ansi-bright-blue'), brightMagenta: t('--ansi-bright-magenta'), brightCyan: t('--ansi-bright-cyan'), brightWhite: t('--ansi-bright-white')
  }
}
