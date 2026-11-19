import { randomUUID } from 'node:crypto'
import type { AgentType, FolderRecord, SessionRecord } from '@shared/types'
import type { NewSession, SessionRepository } from './sessionStore'

/** In-memory repository: fallback when MySQL is down (terminals keep working) and test double. */
export class MemorySessionRepo implements SessionRepository {
  private rows = new Map<string, SessionRecord>()
  private folders = new Map<string, FolderRecord>()

  async create(s: NewSession): Promise<SessionRecord> {
    const id = randomUUID(); const now = Date.now()
    const r: SessionRecord = {
      id, agentType: s.agentType, nativeSessionId: s.nativeSessionId ?? null, title: s.title, workingDirectory: s.workingDirectory,
      transcriptPath: s.transcriptPath ?? null, voiceProfileId: s.voiceProfileId ?? null, playbackSpeed: null,
      foregroundVoiceMode: null, backgroundVoiceMode: null, createdAt: now, lastActivityAt: now, archivedAt: null, folderId: null
    }
    this.rows.set(id, r)
    return r
  }
  async get(id: string) { return this.rows.get(id) ?? null }
  async list(opts: { includeArchived?: boolean } = {}) { return [...this.rows.values()].filter((r) => opts.includeArchived || !r.archivedAt) }
  async update(id: string, patch: Parameters<SessionRepository['update']>[1]) { const r = this.rows.get(id); if (r) this.rows.set(id, { ...r, ...patch }) }
  async setNativeSessionId(id: string, n: string): Promise<'ok' | 'duplicate'> {
    const r = this.rows.get(id)
    if (!r) return 'ok'
    for (const o of this.rows.values()) if (o.id !== id && o.agentType === r.agentType && o.nativeSessionId === n) return 'duplicate'
    this.rows.set(id, { ...r, nativeSessionId: n })
    return 'ok'
  }
  async touch(id: string, at = Date.now()) { const r = this.rows.get(id); if (r) this.rows.set(id, { ...r, lastActivityAt: at }) }
  async archive(id: string, a: boolean) { const r = this.rows.get(id); if (r) this.rows.set(id, { ...r, archivedAt: a ? Date.now() : null }) }
  async findByNative(agent: AgentType, n: string) { return [...this.rows.values()].find((r) => r.agentType === agent && r.nativeSessionId === n) ?? null }
  async listFolders() { return [...this.folders.values()] }
  async createFolder(name: string, parentId: string | null = null) { const f = { id: randomUUID(), name, parentId, createdAt: Date.now() }; this.folders.set(f.id, f); return f }
  async renameFolder(id: string, name: string) { const f = this.folders.get(id); if (f) this.folders.set(id, { ...f, name }) }
  async setFolderParent(id: string, parentId: string | null) { const f = this.folders.get(id); if (f) this.folders.set(id, { ...f, parentId }) }
  async deleteFolder(id: string) {
    const parent = this.folders.get(id)?.parentId ?? null
    this.folders.delete(id)
    for (const [k, f] of this.folders) if (f.parentId === id) this.folders.set(k, { ...f, parentId: parent })
    for (const [k, r] of this.rows) if (r.folderId === id) this.rows.set(k, { ...r, folderId: parent })
  }
  async setFolder(sessionId: string, folderId: string | null) { const r = this.rows.get(sessionId); if (r) this.rows.set(sessionId, { ...r, folderId }) }
}
