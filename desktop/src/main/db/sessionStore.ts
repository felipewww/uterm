import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { AgentType, FolderRecord, SessionRecord, VoiceMode } from '@shared/types'
import type { Pool } from './pool'

export interface NewSession {
  agentType: AgentType
  title: string
  workingDirectory: string
  nativeSessionId?: string | null
  transcriptPath?: string | null
  voiceProfileId?: string | null
  configDir?: string | null
}

export interface SessionRepository {
  create(s: NewSession): Promise<SessionRecord>
  get(id: string): Promise<SessionRecord | null>
  list(opts?: { includeArchived?: boolean }): Promise<SessionRecord[]>
  update(id: string, patch: Partial<Pick<SessionRecord,
    'title' | 'voiceProfileId' | 'playbackSpeed' | 'foregroundVoiceMode' | 'backgroundVoiceMode' | 'transcriptPath' | 'englishCoach'>>): Promise<void>
  setNativeSessionId(id: string, nativeId: string): Promise<'ok' | 'duplicate'>
  touch(id: string, at?: number): Promise<void>
  archive(id: string, archived: boolean): Promise<void>
  /** Removes the session and (by cascade) its stored activity and spoken messages. */
  delete(id: string): Promise<void>
  findByNative(agent: AgentType, nativeId: string): Promise<SessionRecord | null>
  listFolders(): Promise<FolderRecord[]>
  createFolder(name: string, parentId?: string | null): Promise<FolderRecord>
  renameFolder(id: string, name: string): Promise<void>
  setFolderParent(id: string, parentId: string | null): Promise<void>
  /** Children (folders and sessions) move up to the deleted folder's parent. */
  deleteFolder(id: string): Promise<void>
  setFolder(sessionId: string, folderId: string | null): Promise<void>
}

const toMs = (d: Date | null): number | null => (d ? d.getTime() : null)

function rowToSession(r: RowDataPacket): SessionRecord {
  return {
    id: r.id, agentType: r.agent_type, nativeSessionId: r.native_session_id, title: r.title,
    workingDirectory: r.working_directory, transcriptPath: r.transcript_path,
    voiceProfileId: r.voice_profile_id,
    playbackSpeed: r.playback_speed === null ? null : Number(r.playback_speed),
    foregroundVoiceMode: r.foreground_voice_mode as VoiceMode | null,
    backgroundVoiceMode: r.background_voice_mode as VoiceMode | null,
    createdAt: (r.created_at as Date).getTime(), lastActivityAt: (r.last_activity_at as Date).getTime(),
    archivedAt: toMs(r.archived_at), folderId: r.folder_id ?? null, configDir: r.config_dir ?? null,
    englishCoach: r.english_coach === null || r.english_coach === undefined ? null : !!r.english_coach
  }
}

const COLUMN: Record<string, string> = {
  title: 'title', voiceProfileId: 'voice_profile_id', playbackSpeed: 'playback_speed',
  foregroundVoiceMode: 'foreground_voice_mode', backgroundVoiceMode: 'background_voice_mode',
  transcriptPath: 'transcript_path', englishCoach: 'english_coach'
}

export class MySqlSessionStore implements SessionRepository {
  constructor(private pool: Pool) {}

  async create(s: NewSession): Promise<SessionRecord> {
    const id = randomUUID()
    await this.pool.execute(
      `INSERT INTO sessions (id, agent_type, native_session_id, title, working_directory, transcript_path, voice_profile_id, config_dir)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, s.agentType, s.nativeSessionId ?? null, s.title, s.workingDirectory, s.transcriptPath ?? null, s.voiceProfileId ?? null, s.configDir ?? null]
    )
    return (await this.get(id))!
  }

  async get(id: string): Promise<SessionRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT * FROM sessions WHERE id = ?', [id])
    return rows[0] ? rowToSession(rows[0]) : null
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<SessionRecord[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM sessions ${opts.includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY last_activity_at DESC`
    )
    return rows.map(rowToSession)
  }

  async update(id: string, patch: Parameters<SessionRepository['update']>[1]): Promise<void> {
    const sets: string[] = []; const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMN[k]
      if (!col || v === undefined) continue
      sets.push(`${col} = ?`); vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
    }
    if (sets.length === 0) return
    await this.pool.execute(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, [...vals, id] as never[])
  }

  async setNativeSessionId(id: string, nativeId: string): Promise<'ok' | 'duplicate'> {
    try {
      await this.pool.execute('UPDATE sessions SET native_session_id = ? WHERE id = ?', [nativeId, id])
      return 'ok'
    } catch (err) {
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return 'duplicate'
      throw err
    }
  }

  async touch(id: string, at = Date.now()): Promise<void> {
    await this.pool.execute('UPDATE sessions SET last_activity_at = ? WHERE id = ?', [new Date(at), id])
  }

  async archive(id: string, archived: boolean): Promise<void> {
    await this.pool.execute('UPDATE sessions SET archived_at = ? WHERE id = ?', [archived ? new Date() : null, id])
  }

  async listFolders(): Promise<FolderRecord[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT id, name, parent_id, created_at FROM session_folders ORDER BY created_at, name')
    return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id ?? null, createdAt: (r.created_at as Date).getTime() }))
  }

  async createFolder(name: string, parentId: string | null = null): Promise<FolderRecord> {
    const id = randomUUID()
    await this.pool.execute('INSERT INTO session_folders (id, name, parent_id) VALUES (?, ?, ?)', [id, name, parentId])
    return { id, name, parentId, createdAt: Date.now() }
  }

  async renameFolder(id: string, name: string): Promise<void> {
    await this.pool.execute('UPDATE session_folders SET name = ? WHERE id = ?', [name, id])
  }

  async setFolderParent(id: string, parentId: string | null): Promise<void> {
    await this.pool.execute('UPDATE session_folders SET parent_id = ? WHERE id = ?', [parentId, id])
  }

  async deleteFolder(id: string): Promise<void> {
    const [rows] = await this.pool.execute<RowDataPacket[]>('SELECT parent_id FROM session_folders WHERE id = ?', [id])
    const parent = (rows[0]?.parent_id as string | null | undefined) ?? null
    await this.pool.execute('UPDATE session_folders SET parent_id = ? WHERE parent_id = ?', [parent, id])
    await this.pool.execute('UPDATE sessions SET folder_id = ? WHERE folder_id = ?', [parent, id])
    await this.pool.execute('DELETE FROM session_folders WHERE id = ?', [id])
  }

  async setFolder(sessionId: string, folderId: string | null): Promise<void> {
    await this.pool.execute('UPDATE sessions SET folder_id = ? WHERE id = ?', [folderId, sessionId])
  }

  async delete(id: string): Promise<void> {
    await this.pool.execute('DELETE FROM sessions WHERE id = ?', [id])
  }

  async findByNative(agent: AgentType, nativeId: string): Promise<SessionRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM sessions WHERE agent_type = ? AND native_session_id = ?', [agent, nativeId])
    return rows[0] ? rowToSession(rows[0]) : null
  }
}

export type { ResultSetHeader }
