import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import type { Pool } from './pool'

export interface SavedCommand { id: string; sessionId: string; label: string | null; command: string; position: number }

export interface CommandRepository {
  list(sessionId: string): Promise<SavedCommand[]>
  get(id: string): Promise<SavedCommand | null>
  add(sessionId: string, command: string, label?: string | null): Promise<SavedCommand>
  remove(id: string): Promise<void>
}

/** Commands the user chose to keep for a terminal. Only the commands: terminal output is never stored. */
export class MySqlCommandStore implements CommandRepository {
  constructor(private pool: Pool) {}
  private row = (r: RowDataPacket): SavedCommand => ({ id: r.id, sessionId: r.session_id, label: r.label ?? null, command: r.command, position: r.position })

  async list(sessionId: string): Promise<SavedCommand[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT * FROM saved_commands WHERE session_id = ? ORDER BY position, created_at', [sessionId])
    return rows.map(this.row)
  }
  async get(id: string): Promise<SavedCommand | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT * FROM saved_commands WHERE id = ?', [id])
    return rows[0] ? this.row(rows[0]) : null
  }
  async add(sessionId: string, command: string, label: string | null = null): Promise<SavedCommand> {
    const id = randomUUID()
    const [pos] = await this.pool.query<RowDataPacket[]>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM saved_commands WHERE session_id = ?', [sessionId])
    const position = Number(pos[0]?.p ?? 0)
    await this.pool.execute('INSERT INTO saved_commands (id, session_id, label, command, position) VALUES (?,?,?,?,?)', [id, sessionId, label, command, position])
    return { id, sessionId, label, command, position }
  }
  async remove(id: string): Promise<void> { await this.pool.execute('DELETE FROM saved_commands WHERE id = ?', [id]) }
}

export class MemoryCommandStore implements CommandRepository {
  protected rows: SavedCommand[] = []
  async list(sessionId: string) { return this.rows.filter((r) => r.sessionId === sessionId).sort((a, b) => a.position - b.position) }
  async get(id: string) { return this.rows.find((r) => r.id === id) ?? null }
  async add(sessionId: string, command: string, label: string | null = null) {
    const position = this.rows.filter((r) => r.sessionId === sessionId).length
    const c = { id: randomUUID(), sessionId, label, command, position }
    this.rows.push(c)
    return c
  }
  async remove(id: string) { this.rows = this.rows.filter((r) => r.id !== id) }
}
