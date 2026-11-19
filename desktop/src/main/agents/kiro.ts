import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentAdapter, AgentObserver, LaunchInput, LaunchSpec, ObserverContext } from './adapter'
import { run, which } from './exec'
import { KiroTranscriptParser } from './kiroTranscript'
import { voiceSetupPrompt } from '../speechInstructions'
import { TranscriptTail } from './transcriptTail'

export const kiroSessionsDir = () => join(process.env.KIRO_HOME ?? join(homedir(), '.kiro'), 'sessions', 'cli')

export interface KiroSessionMeta { id: string; cwd: string; createdAt: number; title: string }

/** `<id>.json` next to `<id>.jsonl`: {session_id, cwd, created_at, title, …}. */
export function readKiroMeta(file: string): KiroSessionMeta | null {
  try {
    const o = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof o?.session_id !== 'string' || typeof o?.cwd !== 'string') return null
    return { id: o.session_id, cwd: o.cwd, createdAt: Date.parse(o.created_at) || 0, title: typeof o.title === 'string' ? o.title : '' }
  } catch { return null }
}

export class KiroAdapter implements AgentAdapter {
  readonly type = 'kiro' as const
  readonly label = 'Kiro CLI'
  readonly capabilities = {
    preassignedSessionId: false,
    intermediateMessages: 'transcript' as const,
    permissionRequests: 'none' as const,
    interactiveQuestions: 'none' as const,
    notes: [
      'Messages and tool activity come from read-only tailing of the native session log (~/.kiro/sessions/cli).',
      'Kiro does not write permission prompts to that log, so "needs permission" is not detected: watch the terminal.',
      'Cancelling a turn (Esc) is not logged either, so a cancelled turn can keep showing as working.',
      'Speech instructions are sent as the first message of a NEW session (Kiro has no system-prompt flag); Kiro answers with a short greeting. Resumed sessions already carry them.'
    ]
  }

  async detect() {
    const path = await which('kiro-cli')
    if (!path) return { installed: false }
    let version: string | undefined
    try { version = (await run(path, ['--version'])).replace(/^kiro-cli\s*/, '') } catch { /* leave undefined */ }
    return { installed: true, path, version }
  }

  async buildLaunch(i: LaunchInput): Promise<LaunchSpec> {
    const path = (await which('kiro-cli')) ?? 'kiro-cli'
    // A new session starts with the speech instructions as its first message (Kiro has no system-prompt flag); resumed ones already have them.
    const args = i.nativeSessionId ? ['chat', '--resume-id', i.nativeSessionId] : i.instructions ? ['chat', voiceSetupPrompt(i.instructions)] : ['chat']
    return { file: path, args, env: { ECHO_TERM_SESSION_ID: i.sessionKey, ECHO_TERM_AGENT: 'kiro', ECHO_TERM_SOCKET: i.socketPath } }
  }

  createObserver(ctx: ObserverContext): AgentObserver {
    const parser = new KiroTranscriptParser()
    let tail: TranscriptTail | undefined
    let discovery: NodeJS.Timeout | undefined
    const deadline = ctx.startedAt + 90_000

    const attach = (id: string, fromEnd: boolean) => {
      if (tail || !ctx.claimNativeId(id)) return
      const file = join(kiroSessionsDir(), `${id}.jsonl`)
      ctx.setTranscriptPath(file)
      ctx.emit({ type: 'SESSION_STARTED', nativeSessionId: id, payload: { source: fromEnd ? 'resume' : 'startup', transcriptPath: file } })
      tail = new TranscriptTail(file, (line) => parser.parseLine(line).forEach((d) => ctx.emit(d)), { fromEnd })
      tail.start()
      if (discovery) clearInterval(discovery)
    }

    const discover = () => {
      if (tail) return
      if (Date.now() > deadline) { if (discovery) clearInterval(discovery); return }
      const dir = kiroSessionsDir()
      if (ctx.resumedNativeId) { // resume continues the same session files: never replay history
        if (existsSync(join(dir, `${ctx.resumedNativeId}.jsonl`))) attach(ctx.resumedNativeId, true)
        return
      }
      let names: string[] = []
      try { names = readdirSync(dir).filter((n) => n.endsWith('.json')) } catch { return }
      for (const name of names) {
        const file = join(dir, name)
        let born = 0
        try { born = statSync(file).birthtimeMs || statSync(file).mtimeMs } catch { continue }
        if (born < ctx.startedAt - 1000) continue // older than this session
        const meta = readKiroMeta(file)
        if (meta && meta.cwd === ctx.workingDirectory) { attach(meta.id, false); if (tail) return }
      }
    }

    return {
      onHook() { /* Kiro has no uTerm hooks: everything comes from the session log */ },
      start() { discover(); discovery = setInterval(discover, 700); discovery.unref() },
      stop() { if (discovery) clearInterval(discovery); tail?.stop() }
    }
  }
}
