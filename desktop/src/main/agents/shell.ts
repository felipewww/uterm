import { existsSync } from 'node:fs'
import { userInfo } from 'node:os'
import type { AgentAdapter, AgentCapabilities, AgentObserver, DetectResult, LaunchInput, LaunchSpec, ObserverContext } from './adapter'

/** The user's own login shell. */
export function userShell(env: NodeJS.ProcessEnv = process.env): string {
  for (const c of [env.SHELL, safeShell(), process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash', '/bin/sh']) if (c && existsSync(c)) return c
  return '/bin/sh'
}
function safeShell(): string | undefined { try { return userInfo().shell ?? undefined } catch { return undefined } }

/**
 * A plain terminal: no agent, no hooks, no transcript, nothing to speak. It just runs the user's shell in a folder so commands
 * can live next to the agent sessions. It is deliberately not told anything about uTerm (no session env), and voice text is never
 * typed into it (see SessionManager.sendText).
 */
export class ShellAdapter implements AgentAdapter {
  readonly type = 'shell' as const
  readonly label = 'Terminal'
  readonly capabilities: AgentCapabilities = {
    preassignedSessionId: false, intermediateMessages: 'none', permissionRequests: 'none', interactiveQuestions: 'none',
    notes: ['A plain shell for your own commands: no events, nothing is spoken, voice input is disabled.']
  }

  async detect(): Promise<DetectResult> { return { installed: true, path: userShell() } }

  async buildLaunch(_i: LaunchInput): Promise<LaunchSpec> { return { file: userShell(), args: [], env: {} } }

  createObserver(ctx: ObserverContext): AgentObserver {
    return {
      onHook() { /* no hooks */ },
      start() { ctx.emit({ type: 'SESSION_STARTED', timestamp: Date.now(), turnId: null, payload: {} }) }, // STARTING -> IDLE
      stop() { /* nothing to clean up */ }
    }
  }
}


