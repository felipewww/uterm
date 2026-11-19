# Echo-Term design system

Goal: one visual language, and new themes that cost one CSS file.

## Layers (`desktop/src/renderer/`)

| File | Role |
| --- | --- |
| `design/tokens.css` | Scale tokens shared by all themes: font, type sizes, spacing, radii, motion, z-index, panel widths. **No colors.** |
| `design/themes/<id>.css` | A theme: defines every semantic color/effect token under `:root[data-theme='<id>']`. |
| `design/base.css` | Reset, typography, scrollbars, keyframes. |
| `design/primitives.css` | Reusable parts: island, fields, buttons, badge, pill, status dot, spinner, modal, toast. |
| `styles/app.css` | Feature layout (sidebar, toolbar, terminal, voice strip, activity). Composes primitives. |
| `design/theme.ts` | Runtime: `THEMES`, `setTheme`, `initTheme`, `onThemeChange`, `terminalTheme()` (xterm colors from tokens). |

## Rules

1. **No hardcoded colors outside `design/themes/`.** Use semantic tokens (`--surface-*`, `--text-*`, `--accent*`, `--success/warning/danger*`).
2. Use the scale: `--space-*`, `--radius-*`, `--text-*`, `--dur-*`. A new one-off number is a smell; add a token instead.
3. A visual pattern used twice becomes a primitive in `primitives.css`.
4. The terminal's colors are tokens too (`--term-*`, `--ansi-*`); xterm re-reads them when the theme changes.

## Token contract (every theme must define all of these)

- Surfaces: `--surface-frame`, `--surface-island`, `--surface-sunken`, `--surface-raised`, `--surface-hover`, `--border-subtle`, `--ring`, `--divider`
- Text: `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-on-accent`, `--text-on-warning`, `--text-on-danger`
- Accent: `--accent`, `--accent-hover`, `--accent-text`, `--accent-soft`, `--accent-outline`, `--accent-glow`, `--accent-alt`
- Status: `--success`, `--success-glow`, `--warning`, `--warning-soft`, `--warning-outline`, `--warning-glow`, `--danger`, `--danger-soft`, `--danger-glow`, `--danger-solid`, `--danger-solid-hover`, `--info-glow`
- Effects: `--shadow-island`, `--shadow-pop`, `--shadow-modal`, `--overlay`, `--overlay-sunken`, `--scrollbar`, `--scrollbar-hover`, `--mic-gradient`, `--mic-rec-gradient`
- Terminal: `--term-bg`, `--term-fg`, `--term-cursor`, `--term-selection`, and the 16 `--ansi-*` colors

## Adding a theme

1. Copy `design/themes/islands-dark.css`, change the selector to `:root[data-theme='my-theme']` and the values.
2. `@import` it in `styles.css`.
3. Add `{ id: 'my-theme', label: 'My Theme' }` to `THEMES` in `design/theme.ts`.

The choice is stored in `localStorage` for now (Settings → Theme). Moving it into the persisted app settings is a later step.
