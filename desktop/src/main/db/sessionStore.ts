import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { AgentType, SessionRecord, VoiceMode } from '@shared/types'
import type { Pool } from './pool'

export interface NewSession {
  agentType: AgentType
  title: string
  workingDirectory: string
  nativeSessionId?: string | null
  transcriptPath?: string | null
  voiceProfileId?: string | null
}

export interface SessionRepository {
  create(s: NewSession): Promise<SessionRecord>
  get(id: string): Promise<SessionRecord | null>
  list(opts?: { includeArchived?: boolean }): Promise<SessionRecord[]>
  update(id: string, patch: Partial<Pick<SessionRecord,
    'title' | 'voiceProfileId' | 'playbackSpeed' | 'foregroundVoiceMode' | 'backgroundVoiceMode' | 'transcriptPath'>>): Promise<void>
  setNativeSessionId(id: string, nativeId: string): Promise<'ok' | 'duplicate'>
  touch(id: string, at?: number): Promise<void>
  archive(id: string, archived: boolean): Promise<void>
  findByNative(agent: AgentType, nativeId: string): Promise<SessionRecord | null>
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
    archivedAt: toMs(r.archived_at)
  }
}

const COLUMN: Record<string, string> = {
  title: 'title', voiceProfileId: 'voice_profile_id', playbackSpeed: 'playback_speed',
  foregroundVoiceMode: 'foreground_voice_mode', backgroundVoiceMode: 'background_voice_mode',
  transcriptPath: 'transcript_path'
}

export class MySqlSessionStore implements SessionRepository {
  constructor(private pool: Pool) {}

  async create(s: NewSession): Promise<SessionRecord> {
    const id = randomUUID()
    await this.pool.execute(
      `INSERT INTO sessions (id, agent_type, native_session_id, title, working_directory, transcript_path, voice_profile_id)
       VALUES (?,?,?,?,?,?,?)`,
      [id, s.agentType, s.nativeSessionId ?? null, s.title, s.workingDirectory, s.transcriptPath ?? null, s.voiceProfileId ?? null]
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
      sets.push(`${col} = ?`); vals.push(v)
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

  async findByNative(agent: AgentType, nativeId: string): Promise<SessionRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM sessions WHERE agent_type = ? AND native_session_id = ?', [agent, nativeId])
    return rows[0] ? rowToSession(rows[0]) : null
  }
}

export type { ResultSetHeader }
