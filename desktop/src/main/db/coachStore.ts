import { randomUUID } from 'node:crypto'
import type { Pool } from './pool'

export interface CoachEntry { sessionId: string; eventId: string | null; original: string; natural: string }
export interface CoachHistory { record(e: CoachEntry): Promise<void> }

export class MySqlCoachHistory implements CoachHistory {
  constructor(private pool: Pool) {}
  async record(e: CoachEntry): Promise<void> {
    await this.pool.execute('INSERT INTO english_history (id, session_id, event_id, original, natural_text) VALUES (?,?,?,?,?)', [randomUUID(), e.sessionId, e.eventId, e.original, e.natural])
  }
}

export class MemoryCoachHistory implements CoachHistory {
  rows: CoachEntry[] = []
  async record(e: CoachEntry) { this.rows.push(e) }
}
