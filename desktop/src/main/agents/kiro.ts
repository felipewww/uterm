import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EventDraft } from '@shared/events'
import type { AgentAdapter, AgentObserver, LaunchInput, LaunchSpec, ObserverContext } from './adapter'
import { run, which } from './exec'
import { KiroTranscriptParser } from './kiroTranscript'
import { KiroV3Parser } from './kiroV3Transcript'
import { voiceSetupPrompt } from '../speechInstructions'
import { TranscriptTail } from './transcriptTail'

const kiroHome = () => process.env.KIRO_HOME ?? join(homedir(), '.kiro')
/** Kiro 2.x: <id>.json + <id>.jsonl side by side. */
export const kiroSessionsDir = () => join(kiroHome(), 'sessions', 'cli')
/** Kiro 3.x: <workspace hash>/<sess_id>/{session.json, messages.jsonl}. */
export const kiroV3Root = () => join(kiroHome(), 'sessions')

export interface KiroV3Meta { id: string; dir: string; workspaces: string[]; createdAt: number }

/** Every 3.x session folder: `<root>/<hash>/sess_…/session.json`. */
export function listKiroV3Sessions(root = kiroV3Root()): KiroV3Meta[] {
  const out: KiroV3Meta[] = []
  let hashes: string[] = []
  try { hashes = readdirSync(root).filter((h) => h !== 'cli') } catch { return out }
  for (const h of hashes) {
    let names: string[] = []
    try { names = readdirSync(join(root, h)).filter((n) => n.startsWith('sess_')) } catch { continue }
    for (const n of names) {
      const dir = join(root, h, n)
      try {
        const o = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))
        const paths: unknown[] = [...(Array.isArray(o.workspacePaths) ? o.workspacePaths : []), ...(Array.isArray(o.rootPaths) ? o.rootPaths : [])]
        out.push({ id: typeof o.id === 'string' ? o.id : n, dir, workspaces: paths.filter((x): x is string => typeof x === 'string'), createdAt: Date.parse(o.createdAt) || 0 })
      } catch { /* not a session folder (yet) */ }
    }
  }
  return out
}

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
    permissionRequests: 'transcript' as const,
    interactiveQuestions: 'none' as const,
    notes: [
      'Messages and tool activity come from read-only tailing of the native session log (~/.kiro/sessions: the 3.x folders, or cli/ for 2.x).',
      'Kiro 3.x writes its approval prompts and cancelled turns to the log, so "needs permission" is detected there. Kiro 2.x does not, so with 2.x watch the terminal.',
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
    let tail: TranscriptTail | undefined
    let discovery: NodeJS.Timeout | undefined
    const SLOW_AFTER = 90_000 // a new session may only be created when the first message is sent: keep looking, more slowly

    const attach = (id: string, file: string, parse: (line: string) => EventDraft[], fromEnd: boolean) => {
      if (tail || !ctx.claimNativeId(id)) return
      ctx.setTranscriptPath(file)
      ctx.emit({ type: 'SESSION_STARTED', nativeSessionId: id, payload: { source: fromEnd ? 'resume' : 'startup', transcriptPath: file } })
      tail = new TranscriptTail(file, (line) => parse(line).forEach((d) => ctx.emit(d)), { fromEnd })
      tail.start()
      if (discovery) clearInterval(discovery)
    }
    const attachV2 = (id: string, fromEnd: boolean) => { const p = new KiroTranscriptParser(); attach(id, join(kiroSessionsDir(), `${id}.jsonl`), (l) => p.parseLine(l), fromEnd) }
    const attachV3 = (m: KiroV3Meta, fromEnd: boolean) => { const p = new KiroV3Parser(); attach(m.id, join(m.dir, 'messages.jsonl'), (l) => p.parseLine(l), fromEnd) }
    const samePlace = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

    const discover = () => {
      if (tail) return
      if (ctx.resumedNativeId) { // resume continues the same session files: never replay history
        const id = ctx.resumedNativeId
        const v3 = listKiroV3Sessions().find((m) => m.id === id)
        if (v3) attachV3(v3, true)
        else if (existsSync(join(kiroSessionsDir(), `${id}.jsonl`))) attachV2(id, true)
        return
      }
      for (const m of listKiroV3Sessions()) {
        if (m.createdAt < ctx.startedAt - 1000) continue // older than this session
        if (m.workspaces.some((w) => samePlace(w, ctx.workingDirectory)) && existsSync(join(m.dir, 'messages.jsonl'))) { attachV3(m, false); if (tail) return }
      }
      let names: string[] = []
      try { names = readdirSync(kiroSessionsDir()).filter((n) => n.endsWith('.json')) } catch { return }
      for (const name of names) {
        const file = join(kiroSessionsDir(), name)
        let born = 0
        try { born = statSync(file).birthtimeMs || statSync(file).mtimeMs } catch { continue }
        if (born < ctx.startedAt - 1000) continue
        const meta = readKiroMeta(file)
        if (meta && meta.cwd === ctx.workingDirectory) { attachV2(meta.id, false); if (tail) return }
      }
    }

    let slow = false
    const tick = () => {
      discover()
      if (!slow && !tail && Date.now() > ctx.startedAt + SLOW_AFTER) { slow = true; if (discovery) clearInterval(discovery); discovery = setInterval(tick, 3000); discovery.unref() }
    }
    return {
      onHook() { /* Kiro has no uTerm hooks: everything comes from the session log */ },
      start() { discover(); discovery = setInterval(tick, 700); discovery.unref() },
      stop() { if (discovery) clearInterval(discovery); tail?.stop() }
    }
  }
}
