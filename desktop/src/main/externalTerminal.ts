import { spawn } from 'node:child_process'
import type { AgentType } from '@shared/types'
import { which } from './agents/exec'

/**
 * "Open in system terminal": a running process cannot be moved between terminal emulators, so uTerm stops its own copy and opens the
 * user's terminal app in the same folder, resuming the same conversation (agents) or just standing in the same folder (plain shells).
 */
export const TERMINAL_APPS = ['ptyxis', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'x-terminal-emulator'] as const
export type TerminalApp = (typeof TERMINAL_APPS)[number]

/** POSIX single-quote escaping. */
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export interface PopOutInput { agent: AgentType; nativeSessionId: string | null; configDir: string | null }

/** The command to run in the new terminal, or null for a plain shell. Only ids that uTerm itself validated are used, always quoted. */
export function innerCommand(i: PopOutInput): string | null {
  const id = i.nativeSessionId
  switch (i.agent) {
    case 'claude': return `${i.configDir ? `CLAUDE_CONFIG_DIR=${shq(i.configDir)} ` : ''}claude${id ? ` --resume ${shq(id)}` : ''}`
    case 'codex': return `codex${id ? ` resume ${shq(id)}` : ''}`
    case 'kiro': return `kiro-cli chat${id ? ` --resume-id ${shq(id)}` : ''}`
    default: return null
  }
}

/** argv for one terminal app. The command runs in the user's own interactive shell (aliases, PATH) and leaves a shell open when it ends. */
export function terminalArgv(app: TerminalApp, cwd: string, inner: string | null, shell: string): { file: string; args: string[] } {
  const script = inner ? `${inner}; exec ${shq(shell)} -i` : ''
  const run = inner ? [shell, '-ic', script] : []
  switch (app) {
    case 'ptyxis': return { file: app, args: ['--new-window', '-d', cwd, ...(inner ? ['--', ...run] : [])] }
    case 'gnome-terminal': return { file: app, args: [`--working-directory=${cwd}`, ...(inner ? ['--', ...run] : [])] }
    case 'konsole': return { file: app, args: ['--workdir', cwd, ...(inner ? ['-e', ...run] : [])] }
    case 'xfce4-terminal': return { file: app, args: [`--working-directory=${cwd}`, ...(inner ? ['-x', ...run] : [])] }
    case 'kitty': return { file: app, args: ['--directory', cwd, ...run] }
    case 'alacritty': return { file: app, args: ['--working-directory', cwd, ...(inner ? ['-e', ...run] : [])] }
    case 'wezterm': return { file: app, args: ['start', '--cwd', cwd, ...(inner ? ['--', ...run] : [])] }
    default: return { file: app, args: inner ? ['-e', ...run] : [] } // x-terminal-emulator: the folder comes from the process cwd
  }
}

/** macOS: Terminal.app through AppleScript. */
export function macScript(cwd: string, inner: string | null): string {
  const line = `cd ${shq(cwd)}${inner ? ` && ${inner}` : ''}`
  return `tell application "Terminal" to do script "${line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export async function pickTerminal(preferred: string, platform = process.platform): Promise<TerminalApp | 'mac' | null> {
  if (platform === 'darwin') return 'mac'
  const order = preferred !== 'auto' && (TERMINAL_APPS as readonly string[]).includes(preferred) ? [preferred as TerminalApp] : [...TERMINAL_APPS]
  for (const t of order) if (await which(t)) return t
  return null
}

export async function popOut(opts: { preferred: string; cwd: string; input: PopOutInput; shell: string }): Promise<string> {
  const term = await pickTerminal(opts.preferred)
  if (!term) throw new Error('No terminal app was found. Install one (gnome-terminal, konsole, kitty…) or pick it in Settings.')
  const inner = innerCommand(opts.input)
  const spec = term === 'mac'
    ? { file: 'osascript', args: ['-e', macScript(opts.cwd, inner), '-e', 'tell application "Terminal" to activate'] }
    : terminalArgv(term, opts.cwd, inner, opts.shell)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.file, spec.args, { cwd: opts.cwd, detached: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr?.on('data', (d) => { err += String(d).slice(0, 400) })
    child.once('error', (e) => reject(new Error(`Could not start ${spec.file}: ${e.message}`)))
    child.once('exit', (code) => { if (code) reject(new Error(`${spec.file} exited with code ${code}${err ? `: ${err.trim()}` : ''}`)) })
    // launchers like gnome-terminal return at once; one that is still running (or has exited cleanly) after a moment worked
    setTimeout(() => { child.unref(); child.stderr?.destroy(); resolve() }, 700)
  })
  return term === 'mac' ? 'Terminal' : term
}
