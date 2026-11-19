import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ClaudeNormalizer } from '../hooks/claudeNormalizer'
import { stateDir } from '../config'
import type { AgentAdapter, AgentObserver, LaunchInput, LaunchSpec, ObserverContext } from './adapter'
import { run, which } from './exec'

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly type = 'claude' as const
  readonly label = 'Claude Code'
  readonly capabilities = {
    preassignedSessionId: true,
    intermediateMessages: 'hook' as const,
    permissionRequests: 'hook' as const,
    interactiveQuestions: 'hook' as const,
    notes: ['MessageDisplay hook streams assistant text; AskUserQuestion arrives via PreToolUse.']
  }

  constructor(private repoRoot: string) {}

  async detect() {
    const path = await which('claude')
    if (!path) return { installed: false }
    let version: string | undefined
    try { version = (await run(path, ['--version'])).split(' ')[0] } catch { /* leave undefined */ }
    return { installed: true, path, version }
  }

  /** Hooks are injected per process via --settings: ~/.claude/settings.json is never touched. */
  private ensureSettingsFile(): string {
    const dir = stateDir()
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = join(dir, 'claude-hooks.settings.json')
    const script = join(this.repoRoot, 'hooks', 'claude', 'hook.mjs')
    const tpl = readFileSync(join(this.repoRoot, 'hooks', 'claude', 'hooks.template.json'), 'utf8').replaceAll('__HOOK_SCRIPT__', script)
    if (!existsSync(file) || readFileSync(file, 'utf8') !== tpl) writeFileSync(file, tpl, { mode: 0o600 })
    return file
  }

  async buildLaunch(i: LaunchInput): Promise<LaunchSpec> {
    const path = (await which('claude')) ?? 'claude'
    const args = ['--settings', this.ensureSettingsFile()]
    let newNativeSessionId: string | undefined
    if (i.nativeSessionId) args.push('--resume', i.nativeSessionId)
    else { newNativeSessionId = randomUUID(); args.push('--session-id', newNativeSessionId) }
    if (i.instructions) args.push('--append-system-prompt', i.instructions)
    return {
      file: path, args, newNativeSessionId,
      env: { ECHO_TERM_SESSION_ID: i.sessionKey, ECHO_TERM_AGENT: 'claude', ECHO_TERM_SOCKET: i.socketPath }
    }
  }

  createObserver(ctx: ObserverContext): AgentObserver {
    const n = new ClaudeNormalizer()
    let announced: string | null = null
    let timer: NodeJS.Timeout | undefined
    return {
      onHook(payload) {
        const drafts = n.normalize(payload)
        const native = typeof payload.session_id === 'string' ? payload.session_id : null
        if (native && native !== announced) {
          if (!ctx.claimNativeId(native)) {
            console.warn('[claude] native session already owned by another running session')
            return
          }
          announced = native
        }
        if (typeof payload.transcript_path === 'string') ctx.setTranscriptPath(payload.transcript_path)
        for (const d of drafts) ctx.emit(d)
      },
      start() {
        timer = setInterval(() => { for (const d of [...n.flushStale(), ...n.tick()]) ctx.emit(d) }, 250)
        timer.unref()
      },
      stop() { if (timer) clearInterval(timer) }
    }
  }
}
