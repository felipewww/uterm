import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { DEFAULT_SETTINGS, type AppSettings, type VoiceProfile } from '@shared/types'
import type { AnyAgentEvent } from '@shared/events'
import type { Pool } from './pool'

export class SettingsStore {
  constructor(private pool: Pool) {}

  async load(): Promise<AppSettings> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT setting_key, setting_value FROM settings')
    const stored: Record<string, unknown> = {}
    for (const r of rows) stored[r.setting_key] = r.setting_value // mysql2 already decodes JSON columns
    return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
  }

  /** Drops stored keys (settings that no longer exist). */
  async remove(keys: string[]): Promise<void> {
    for (const k of keys) await this.pool.execute('DELETE FROM settings WHERE setting_key = ?', [k])
  }

  async save(patch: Partial<AppSettings>): Promise<void> {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue
      await this.pool.execute(
        'INSERT INTO settings (setting_key, setting_value) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
        [k, JSON.stringify(v)])
    }
  }
}

/** Relevant events only (not deltas/tool noise), compact payloads. */
const PERSISTED = new Set(['USER_PROMPT_SUBMITTED', 'AGENT_PROGRESS', 'QUESTION_REQUESTED', 'PERMISSION_REQUESTED', 'AGENT_ERROR', 'TURN_COMPLETED'])

export class EventStore {
  constructor(private pool: Pool) {}

  async record(e: AnyAgentEvent): Promise<void> {
    if (!PERSISTED.has(e.type)) return
    const payload = JSON.stringify(e.payload).slice(0, 20000)
    await this.pool.execute(
      'INSERT INTO agent_events (id, session_id, event_type, turn_id, payload, occurred_at) VALUES (?,?,?,?,CAST(? AS JSON),?)',
      [e.id, e.sessionId, e.type, e.turnId, payload, new Date(e.timestamp)])
  }

  async recent(sessionId: string, limit = 100): Promise<Array<{ id: string; type: string; payload: unknown; at: number; spoken: boolean; natural?: string }>> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT e.id, e.event_type, e.payload, e.occurred_at,
              EXISTS(SELECT 1 FROM spoken_messages m WHERE m.event_id = e.id) AS spoken,
              (SELECT h.natural_text FROM english_history h WHERE h.event_id = e.id LIMIT 1) AS natural_text
       FROM agent_events e WHERE e.session_id = ? ORDER BY e.occurred_at DESC LIMIT ?`, [sessionId, limit])
    return rows.reverse().map((r) => ({
      id: r.id as string, type: r.event_type, at: (r.occurred_at as Date).getTime(),
      payload: r.payload, spoken: !!r.spoken, natural: r.natural_text ?? undefined
    }))
  }

  async recordSpoken(sessionId: string, eventId: string, voiceId: string | null, priority: number, text: string): Promise<void> {
    await this.pool.execute(
      'INSERT INTO spoken_messages (id, session_id, event_id, voice_profile_id, priority, text) VALUES (?,?,?,?,?,?)',
      [randomUUID(), sessionId, eventId, voiceId, priority, text])
  }
}

export type { VoiceProfile }

export class VoiceProfileStore {
  constructor(private pool: Pool) {}

  async list(): Promise<VoiceProfile[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT id, name FROM voice_profiles WHERE id NOT LIKE '%:%' ORDER BY is_default DESC, name") // cloud voices ("gemini:Kore") are rows only to satisfy the sessions FK
    return rows.map((r) => ({ id: r.id, name: r.name }))
  }

  async upsert(p: VoiceProfile): Promise<void> {
    await this.pool.execute(
      'INSERT INTO voice_profiles (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [p.id, p.name])
  }

  async remove(id: string): Promise<void> {
    if (id === 'default') return
    await this.pool.execute('DELETE FROM voice_profiles WHERE id = ?', [id])
  }
}
