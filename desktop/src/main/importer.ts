import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AgentType } from '@shared/types'
import { readSessionMeta } from './agents/codex'
import { kiroSessionsDir, readKiroMeta } from './agents/kiro'
import { claudeProfiles } from './agents/claudeProfiles'

export interface ImportableSession { agent: AgentType; nativeId: string; cwd: string; title: string; mtime: number; configDir?: string | null }

function readHead(file: string, bytes = 96 * 1024): string {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    return buf.toString('utf8', 0, n)
  } finally { closeSync(fd) }
}

/** Claude: <config dir>/projects/<slug>/<sessionId>.jsonl — records carry sessionId, cwd and user messages. Every known config folder is scanned. */
function scanClaude(limit: number): ImportableSession[] {
  const out: ImportableSession[] = []
  for (const profile of claudeProfiles()) out.push(...scanClaudeDir(join(profile.resolved, 'projects'), profile.dir))
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

function scanClaudeDir(root: string, configDir: string | null): ImportableSession[] {
  const out: ImportableSession[] = []
  try {
    for (const slug of readdirSync(root)) {
      const dir = join(root, slug)
      let files: string[] = []
      try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')) } catch { continue }
      for (const f of files) {
        const file = join(dir, f)
        let mtime = 0
        try { mtime = statSync(file).mtimeMs } catch { continue }
        let cwd = ''; let title = ''
        for (const line of readHead(file).split('\n')) {
          try {
            const o = JSON.parse(line)
            if (!cwd && typeof o.cwd === 'string') cwd = o.cwd
            if (!title && o.type === 'user' && typeof o.message?.content === 'string' && !o.isMeta) title = o.message.content.replace(/\s+/g, ' ').slice(0, 70)
            if (cwd && title) break
          } catch { /* partial last line */ }
        }
        const id = f.slice(0, -'.jsonl'.length)
        if (cwd && /^[0-9a-f-]{36}$/.test(id)) out.push({ agent: 'claude', nativeId: id, cwd, title: title || 'Claude conversation', mtime, configDir })
      }
    }
  } catch { /* no Claude history */ }
  return out
}

function* walkRollouts(dir: string, depth = 0): Generator<string> {
  let names: string[] = []
  try { names = readdirSync(dir).sort().reverse() } catch { return }
  for (const n of names) {
    const p = join(dir, n)
    if (depth < 3) { try { if (statSync(p).isDirectory()) { yield* walkRollouts(p, depth + 1); continue } } catch { continue } }
    if (n.startsWith('rollout-') && n.endsWith('.jsonl')) yield p
  }
}

function scanCodex(limit: number): ImportableSession[] {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
  const out: ImportableSession[] = []
  for (const file of walkRollouts(root)) {
    if (out.length >= limit) break
    const meta = readSessionMeta(file)
    if (!meta) continue
    let mtime = 0
    try { mtime = statSync(file).mtimeMs } catch { continue }
    let title = 'Codex conversation'
    for (const line of readHead(file, 256 * 1024).split('\n')) {
      try {
        const o = JSON.parse(line)
        if (o.type === 'event_msg' && o.payload?.type === 'user_message' && typeof o.payload.message === 'string') { title = o.payload.message.replace(/\s+/g, ' ').slice(0, 70); break }
      } catch { /* ignore */ }
    }
    out.push({ agent: 'codex', nativeId: meta.id, cwd: meta.cwd, title, mtime })
  }
  return out
}

/** Kiro: ~/.kiro/sessions/cli/<id>.json (+ .jsonl). Only sessions that actually have a conversation are offered. */
function scanKiro(limit: number): ImportableSession[] {
  const dir = kiroSessionsDir()
  const out: ImportableSession[] = []
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      const meta = readKiroMeta(join(dir, name))
      if (!meta) continue
      let mtime = 0; let size = 0
      try { const st = statSync(join(dir, `${meta.id}.jsonl`)); mtime = st.mtimeMs; size = st.size } catch { continue }
      if (size === 0) continue // empty log: nothing to resume
      out.push({ agent: 'kiro', nativeId: meta.id, cwd: meta.cwd, title: meta.title.replace(/\s+/g, ' ').slice(0, 70) || 'Kiro conversation', mtime })
    }
  } catch { /* no Kiro history */ }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

/** Only sessions with reliable id + cwd metadata are offered. */
export function listImportable(limit = 40): ImportableSession[] {
  return [...scanClaude(limit), ...scanCodex(limit), ...scanKiro(limit)].sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}
