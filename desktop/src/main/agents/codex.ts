import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CodexTranscriptParser } from './codexTranscript'
import { HookPayload } from '../hooks/schemas'
import { summarizeTool } from '../hooks/claudeNormalizer'
import type { AgentAdapter, AgentObserver, LaunchInput, LaunchSpec, ObserverContext } from './adapter'
import { nodeEnv, run, which } from './exec'
import { TranscriptTail } from './transcriptTail'

const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), '.codex')

/** First line of a rollout file is session_meta; returns {id, cwd} or null. */
export function readSessionMeta(file: string): { id: string; cwd: string } | null {
  try {
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(64 * 1024)
      const n = readSync(fd, buf, 0, buf.length, 0)
      const first = buf.toString('utf8', 0, n).split('\n')[0] ?? ''
      const o = JSON.parse(first)
      if (o?.type === 'session_meta' && typeof o.payload?.id === 'string' && typeof o.payload?.cwd === 'string') {
        return { id: o.payload.id, cwd: o.payload.cwd }
      }
    } finally { closeSync(fd) }
  } catch { /* partially written or unreadable */ }
  return null
}

function dayDirs(now = new Date()): string[] {
  const dirs: string[] = []
  for (const back of [0, 1]) {
    const d = new Date(now.getTime() - back * 86400000)
    dirs.push(join(codexHome(), 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')))
  }
  return dirs
}

function findRolloutById(id: string): string | null {
  const root = join(codexHome(), 'sessions')
  if (!existsSync(root)) return null
  const walk = (dir: string, depth: number): string | null => {
    for (const name of readdirSync(dir).sort().reverse()) {
      const p = join(dir, name)
      if (depth < 3 && statSync(p).isDirectory()) { const r = walk(p, depth + 1); if (r) return r }
      else if (name.endsWith(`${id}.jsonl`)) return p
    }
    return null
  }
  try { return walk(root, 0) } catch { return null }
}

/** True when ~/.codex/config.toml (or $CODEX_HOME) already defines developer_instructions: ours would silently replace it. */
export function hasOwnDeveloperInstructions(home = codexHome()): boolean {
  try { return /^\s*developer_instructions\s*=/m.test(readFileSync(join(home, 'config.toml'), 'utf8')) } catch { return false }
}

export class CodexAdapter implements AgentAdapter {
  readonly type = 'codex' as const
  readonly label = 'Codex CLI'
  readonly capabilities = {
    preassignedSessionId: false,
    intermediateMessages: 'transcript' as const,
    permissionRequests: 'hook' as const,
    interactiveQuestions: 'none' as const,
    notes: [
      'Assistant commentary/final messages come from read-only tailing of the native rollout JSONL.',
      'Permission requests need the uTerm hooks to be trusted once via /hooks inside Codex.',
      'Interactive question events are not exposed by Codex hooks/transcripts: visual only.',
      'Speech instructions (<voice> summary, expressive tags) are passed per process with -c developer_instructions=…; ~/.codex/config.toml is untouched. Skipped if you already set developer_instructions there.'
    ]
  }

  async detect() {
    const path = await which('codex')
    if (!path) return { installed: false }
    let version: string | undefined
    try { version = (await run(path, ['--version'])).replace(/^codex-cli\s*/, '') } catch { /* leave undefined */ }
    return { installed: true, path, version }
  }

  async buildLaunch(i: LaunchInput): Promise<LaunchSpec> {
    const path = (await which('codex')) ?? 'codex'
    // --no-alt-screen: Codex's full-screen mode has no scrollback in a terminal widget (no scrollbar, no mouse-wheel history); inline mode keeps it.
    const args = ['--no-alt-screen', ...(i.nativeSessionId ? ['resume', i.nativeSessionId] : [])]
    // `-c key=value` is a per-process override (a TOML value; a JSON string literal is a valid TOML string). Never overrides instructions the user set themselves.
    if (i.instructions && !hasOwnDeveloperInstructions()) args.unshift('-c', `developer_instructions=${JSON.stringify(i.instructions)}`) // options go before the subcommand
    return { file: path, args, env: { ECHO_TERM_SESSION_ID: i.sessionKey, ECHO_TERM_AGENT: 'codex', ECHO_TERM_SOCKET: i.socketPath, ...nodeEnv() } }
  }

  createObserver(ctx: ObserverContext): AgentObserver {
    const parser = new CodexTranscriptParser()
    let tail: TranscriptTail | undefined
    let discovery: NodeJS.Timeout | undefined
    let attachedId: string | null = null
    const deadline = ctx.startedAt + 90_000

    const attach = (file: string, id: string, fromEnd: boolean) => {
      if (tail || !ctx.claimNativeId(id)) return
      attachedId = id
      ctx.setTranscriptPath(file)
      tail = new TranscriptTail(file, (line) => parser.parseLine(line).forEach((d) => ctx.emit(d)), { fromEnd })
      tail.start()
      if (discovery) clearInterval(discovery)
    }

    const discover = () => {
      if (tail) return
      if (Date.now() > deadline) { if (discovery) clearInterval(discovery); return }
      if (ctx.resumedNativeId) {
        const f = findRolloutById(ctx.resumedNativeId)
        if (f) attach(f, ctx.resumedNativeId, true) // resume: never replay history
        return
      }
      for (const dir of dayDirs()) {
        if (!existsSync(dir)) continue
        for (const name of readdirSync(dir)) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
          const file = join(dir, name)
          let created = 0
          try { created = statSync(file).birthtimeMs || statSync(file).mtimeMs } catch { continue }
          if (created < ctx.startedAt - 1000) continue // older than this session
          const meta = readSessionMeta(file)
          if (meta && meta.cwd === ctx.workingDirectory) { attach(file, meta.id, false); if (tail) return }
        }
      }
    }

    return {
      onHook(payload) {
        const p = HookPayload.safeParse(payload)
        if (!p.success) return
        const h = p.data
        if (h.hook_event_name === 'SessionStart' && h.session_id && h.transcript_path && !tail) {
          attach(h.transcript_path, h.session_id, !!ctx.resumedNativeId)
        } else if (h.hook_event_name === 'PermissionRequest') {
          ctx.emit({ type: 'PERMISSION_REQUESTED', payload: { tool: h.tool_name, summary: summarizeTool(h.tool_name, h.tool_input) } })
        }
      },
      start() {
        discover()
        discovery = setInterval(discover, 700)
        discovery.unref()
      },
      stop() {
        if (discovery) clearInterval(discovery)
        tail?.stop()
        void attachedId
      }
    }
  }
}
