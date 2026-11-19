import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import type { AgentType, AppSettings, FolderRecord, RuntimeState, SessionRecord, SessionView } from '@shared/types'
import type { AnyAgentEvent, EventDraft } from '@shared/events'
import type { AgentAdapter, AgentObserver } from './agents/adapter'
import type { SessionRepository } from './db/sessionStore'
import type { EventBus } from './events/eventBus'
import type { PtyManager } from './pty/ptyManager'
import { searchPath } from './agents/exec'
import { ReorderBuffer } from './hooks/reorderBuffer'
import { nextState, needsAttention } from './sessionState'

type HookEnv = { agent: AgentType; sessionKey: string; seq?: number; payload: Record<string, unknown> }

interface Runtime {
  state: RuntimeState
  observer: AgentObserver
  startedAt: number
  attention: boolean
  muted: boolean
  lastEventAt: number
}

export interface SessionManagerDeps {
  repo: SessionRepository
  pty: PtyManager
  bus: EventBus
  adapters: Record<AgentType, AgentAdapter>
  socketPath: string
  settings(): AppSettings
  speechInstructions(): string | null
  onViewChanged(view: SessionView): void
  onFoldersChanged?(folders: FolderRecord[]): void
  onPersistenceError(message: string): void
}

export class SessionManager {
  private records = new Map<string, SessionRecord>()
  private folders = new Map<string, FolderRecord>()
  private runtime = new Map<string, Runtime>()
  private selectedId: string | null = null
  private hookBuffers = new Map<string, ReorderBuffer<HookEnv>>()

  constructor(private d: SessionManagerDeps) {}

  async load(): Promise<void> {
    this.records = new Map((await this.d.repo.list({ includeArchived: true })).map((r) => [r.id, r]))
    this.folders = new Map((await this.d.repo.listFolders()).map((f) => [f.id, f]))
  }

  getRecord(id: string): SessionRecord | undefined { return this.records.get(id) }
  isRunning(id: string): boolean { return this.runtime.has(id) && this.runtime.get(id)!.state !== 'CLOSED' }
  isMuted(id: string): boolean { return this.runtime.get(id)?.muted ?? false }
  runtimeState(id: string): RuntimeState { return this.runtime.get(id)?.state ?? 'CLOSED' }
  get selected(): string | null { return this.selectedId }

  view(id: string, speakingId: string | null = null): SessionView | undefined {
    const r = this.records.get(id)
    if (!r) return undefined
    const rt = this.runtime.get(id)
    return {
      ...r,
      runtimeState: rt?.state ?? 'CLOSED',
      running: !!rt && rt.state !== 'CLOSED',
      needsAttention: rt?.attention ?? false,
      muted: rt?.muted ?? false,
      speaking: speakingId === id
    }
  }

  views(speakingId: string | null = null): SessionView[] {
    return [...this.records.keys()].map((id) => this.view(id, speakingId)!).sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  private publishView(id: string): void {
    const v = this.view(id)
    if (v) this.d.onViewChanged(v)
  }

  private async safely<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
    try { return await fn() } catch (err) {
      this.d.onPersistenceError(`Could not ${what}: ${(err as Error).message}. Terminals keep running.`)
      return undefined
    }
  }

  async create(input: { agentType: AgentType; title: string; workingDirectory: string }): Promise<SessionView> {
    const dir = input.workingDirectory
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Directory does not exist: ${dir}`)
    const s = this.d.settings()
    const rec = await this.d.repo.create({
      agentType: input.agentType, title: input.title.trim() || dirName(dir), workingDirectory: dir,
      voiceProfileId: s.defaultVoiceId
    })
    this.records.set(rec.id, rec)
    await this.start(rec.id, 100, 30)
    return this.view(rec.id)!
  }

  /** Registers an existing native conversation (reliable id + cwd only); never duplicates one. */
  async importNative(input: { agentType: AgentType; nativeSessionId: string; workingDirectory: string; title: string }): Promise<SessionView> {
    for (const r of this.records.values()) {
      if (r.agentType === input.agentType && r.nativeSessionId === input.nativeSessionId) return this.view(r.id)!
    }
    if (!existsSync(input.workingDirectory)) throw new Error(`Directory no longer exists: ${input.workingDirectory}`)
    const rec = await this.d.repo.create({
      agentType: input.agentType, title: input.title.trim() || dirName(input.workingDirectory), workingDirectory: input.workingDirectory,
      nativeSessionId: input.nativeSessionId, voiceProfileId: this.d.settings().defaultVoiceId
    })
    this.records.set(rec.id, rec)
    return this.view(rec.id)!
  }

  /** Starts (new) or resumes (native id known) the agent in a PTY. */
  async start(id: string, cols: number, rows: number): Promise<void> {
    const rec = this.records.get(id)
    if (!rec) throw new Error('unknown session')
    if (this.isRunning(id)) return
    if (!existsSync(rec.workingDirectory)) throw new Error(`Working directory no longer exists: ${rec.workingDirectory}`)
    const adapter = this.d.adapters[rec.agentType]
    const detected = await adapter.detect()
    if (!detected.installed) throw new Error(`${adapter.label} is not installed or not on PATH`)

    // Never run two processes on the same native conversation.
    if (rec.nativeSessionId) {
      for (const [otherId, other] of this.records) {
        if (otherId !== id && other.agentType === rec.agentType && other.nativeSessionId === rec.nativeSessionId && this.isRunning(otherId)) {
          throw new Error(`That conversation is already open in session "${other.title}"`)
        }
      }
    }

    const launch = await adapter.buildLaunch({
      sessionKey: id, nativeSessionId: rec.nativeSessionId, workingDirectory: rec.workingDirectory,
      socketPath: this.d.socketPath, instructions: this.d.speechInstructions()
    })
    const observer = adapter.createObserver({
      sessionId: id, workingDirectory: rec.workingDirectory, startedAt: Date.now(), resumedNativeId: rec.nativeSessionId,
      emit: (draft) => this.emit(id, draft),
      claimNativeId: (native) => this.claimNative(id, native),
      setTranscriptPath: (p) => { void this.setTranscript(id, p) }
    })
    this.runtime.set(id, { state: 'STARTING', observer, startedAt: Date.now(), attention: false, muted: false, lastEventAt: Date.now() })

    try {
      this.d.pty.spawn(id, {
        file: launch.file, args: launch.args, cwd: rec.workingDirectory, cols, rows,
        env: { ...cleanEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', ...launch.env }
      })
    } catch (err) {
      this.runtime.delete(id)
      throw err
    }
    observer.start()
    if (launch.newNativeSessionId) this.claimNative(id, launch.newNativeSessionId)
    this.publishView(id)
  }

  /** Synchronous in-memory claim (observers need an immediate answer); persistence follows. */
  private claimNative(id: string, native: string): boolean {
    const rec = this.records.get(id)
    if (!rec) return false
    if (rec.nativeSessionId === native) return true
    for (const [otherId, other] of this.records) {
      if (otherId !== id && other.agentType === rec.agentType && other.nativeSessionId === native && this.isRunning(otherId)) return false
    }
    this.records.set(id, { ...rec, nativeSessionId: native })
    this.publishView(id)
    void this.safely('save the native session id', async () => {
      if ((await this.d.repo.setNativeSessionId(id, native)) === 'duplicate') {
        this.d.onPersistenceError('Another saved session already references this conversation; resume may open the older entry.')
      }
    })
    return true
  }

  private async setTranscript(id: string, path: string): Promise<void> {
    const rec = this.records.get(id)
    if (!rec || rec.transcriptPath === path) return
    this.records.set(id, { ...rec, transcriptPath: path })
    await this.safely('save the transcript path', () => this.d.repo.update(id, { transcriptPath: path }))
  }

  /** Entry for every event source (hooks, transcripts). */
  emit(id: string, draft: EventDraft): void {
    const rt = this.runtime.get(id)
    const rec = this.records.get(id)
    if (!rt || !rec) return
    const event = this.d.bus.publish({ sessionId: id, agent: rec.agentType, nativeSessionId: rec.nativeSessionId }, draft)
    rt.lastEventAt = event.timestamp
    this.applyEvent(id, rt, event)
  }

  private applyEvent(id: string, rt: Runtime, e: AnyAgentEvent): void {
    rt.state = nextState(rt.state, e)
    if (needsAttention(e) && this.selectedId !== id) rt.attention = true
    if (e.type === 'USER_PROMPT_SUBMITTED' || e.type === 'TURN_COMPLETED') {
      const rec = this.records.get(id)
      if (rec) this.records.set(id, { ...rec, lastActivityAt: e.timestamp })
      void this.safely('update session activity', () => this.d.repo.touch(id, e.timestamp))
    }
    this.publishView(id)
  }

  /** Hook entry point. Events are re-sorted by their monotonic start time before delivery. */
  handleHook(env: HookEnv): void {
    const rt = this.runtime.get(env.sessionKey)
    const rec = this.records.get(env.sessionKey)
    if (!rt || !rec || rec.agentType !== env.agent) return // unmanaged or stale: ignore
    let buf = this.hookBuffers.get(env.sessionKey)
    if (!buf) {
      const key = env.sessionKey
      buf = new ReorderBuffer<HookEnv>(HOOK_REORDER_MS, (items) => {
        const live = this.runtime.get(key)
        if (live) for (const h of items) live.observer.onHook(h.payload)
      })
      this.hookBuffers.set(key, buf)
    }
    buf.push(env)
  }

  select(id: string | null): void {
    this.selectedId = id
    if (id) {
      const rt = this.runtime.get(id)
      if (rt?.attention) { rt.attention = false; this.publishView(id) }
    }
  }

  onPtyExit(id: string, code: number): void {
    const rt = this.runtime.get(id)
    if (!rt) return
    this.hookBuffers.get(id)?.flush(true)
    this.hookBuffers.delete(id)
    rt.observer.stop()
    rt.state = 'CLOSED'
    rt.attention = false
    this.d.pty.forget(id)
    this.publishView(id)
    void code
  }

  async stop(id: string): Promise<void> {
    await this.d.pty.kill(id)
    this.onPtyExit(id, 0)
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runtime.keys()].filter((id) => this.isRunning(id)).map((id) => this.stop(id)))
  }

  runningCount(): number { return [...this.runtime.keys()].filter((id) => this.isRunning(id)).length }

  setMuted(id: string, muted: boolean): void {
    const rt = this.runtime.get(id)
    if (rt) { rt.muted = muted; this.publishView(id) }
  }

  async rename(id: string, title: string): Promise<void> {
    const rec = this.records.get(id)
    const t = title.trim().slice(0, 160)
    if (!rec || !t) return
    this.records.set(id, { ...rec, title: t })
    this.publishView(id)
    await this.safely('rename the session', () => this.d.repo.update(id, { title: t }))
  }

  async updateSettings(id: string, patch: Partial<Pick<SessionRecord, 'voiceProfileId' | 'playbackSpeed' | 'foregroundVoiceMode' | 'backgroundVoiceMode'>>): Promise<void> {
    const rec = this.records.get(id)
    if (!rec) return
    this.records.set(id, { ...rec, ...patch })
    this.publishView(id)
    await this.safely('save session settings', () => this.d.repo.update(id, patch))
  }

  folderList(): FolderRecord[] { return [...this.folders.values()] }
  private publishFolders(): void { this.d.onFoldersChanged?.(this.folderList()) }

  async createFolder(name: string, parentId: string | null = null): Promise<FolderRecord | undefined> {
    const n = name.trim().slice(0, 80)
    if (!n || (parentId !== null && !this.folders.has(parentId))) return undefined
    const f = (await this.safely('create the folder', () => this.d.repo.createFolder(n, parentId))) ?? { id: randomUUID(), name: n, parentId, createdAt: Date.now() }
    this.folders.set(f.id, f)
    this.publishFolders()
    return f
  }

  async renameFolder(id: string, name: string): Promise<void> {
    const f = this.folders.get(id)
    const n = name.trim().slice(0, 80)
    if (!f || !n) return
    this.folders.set(id, { ...f, name: n })
    this.publishFolders()
    await this.safely('rename the folder', () => this.d.repo.renameFolder(id, n))
  }

  /** True when `candidate` is `id` itself or sits somewhere below it. */
  private isInside(candidate: string | null, id: string): boolean {
    for (let c = candidate, guard = 0; c && guard < 1000; guard++) {
      if (c === id) return true
      c = this.folders.get(c)?.parentId ?? null
    }
    return false
  }

  /** parentId null = top level. A folder can't go inside itself or one of its own subfolders. */
  async moveFolder(id: string, parentId: string | null): Promise<boolean> {
    const f = this.folders.get(id)
    if (!f || (parentId !== null && !this.folders.has(parentId)) || this.isInside(parentId, id)) return false
    if (f.parentId === parentId) return true
    this.folders.set(id, { ...f, parentId })
    this.publishFolders()
    await this.safely('move the folder', () => this.d.repo.setFolderParent(id, parentId))
    return true
  }

  /** Contents move up one level. */
  async deleteFolder(id: string): Promise<void> {
    const f = this.folders.get(id)
    if (!f) return
    const parent = f.parentId
    this.folders.delete(id)
    for (const [k, c] of this.folders) if (c.parentId === id) this.folders.set(k, { ...c, parentId: parent })
    for (const [sid, r] of this.records) if (r.folderId === id) { this.records.set(sid, { ...r, folderId: parent }); this.publishView(sid) }
    this.publishFolders()
    await this.safely('delete the folder', () => this.d.repo.deleteFolder(id))
  }

  /** folderId null = unfiled. */
  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const rec = this.records.get(id)
    if (!rec || (folderId !== null && !this.folders.has(folderId))) return
    this.records.set(id, { ...rec, folderId })
    this.publishView(id)
    await this.safely('move the session', () => this.d.repo.setFolder(id, folderId))
  }

  async archive(id: string, archived: boolean): Promise<void> {
    if (archived && this.isRunning(id)) await this.stop(id)
    const rec = this.records.get(id)
    if (!rec) return
    this.records.set(id, { ...rec, archivedAt: archived ? Date.now() : null })
    this.publishView(id)
    await this.safely('archive the session', () => this.d.repo.archive(id, archived))
  }

  /**
   * Voice-transcript delivery. Text is never sent into a permission menu or an
   * interactive question (the user must answer those natively), and automatic
   * submission only happens from a known-idle input state.
   */
  sendText(id: string, text: string, opts: { auto: boolean; force?: boolean }): { sent: boolean; reason?: 'not-running' | 'prompt-active' | 'not-idle' } {
    const rt = this.runtime.get(id)
    if (!rt || !this.isRunning(id)) return { sent: false, reason: 'not-running' }
    const blocked = rt.state === 'WAITING_FOR_PERMISSION' || rt.state === 'WAITING_FOR_INPUT'
    if (blocked && !opts.force) return { sent: false, reason: 'prompt-active' }
    if (opts.auto && rt.state !== 'IDLE') return { sent: false, reason: 'not-idle' }
    // Bracketed paste keeps multi-line text from being treated as several submissions.
    this.d.pty.write(id, `\x1b[200~${text.replace(/\x1b/g, '')}\x1b[201~`)
    setTimeout(() => this.d.pty.write(id, '\r'), 150)
    return { sent: true }
  }

  canAutoSubmit(id: string): boolean { return this.isRunning(id) && this.runtime.get(id)!.state === 'IDLE' }
}

export const HOOK_REORDER_MS = 200

const dirName = (p: string): string => p.split('/').filter(Boolean).pop() ?? 'session'

function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue
    if (k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS') continue // don't leak Electron internals into the agent
    if (k === 'CLAUDE_CODE_CHILD_SESSION') continue // set when launched from inside another Claude session
    if (k.startsWith('ECHO_TERM_DB_')) continue // never hand DB credentials to agents
    out[k] = v
  }
  out.PATH = searchPath(out.PATH ?? '') // agents (and the tools they start) must find each other even when launched from a GUI
  return out
}
