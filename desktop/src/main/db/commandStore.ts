import { randomUUID } from 'node:crypto'
export interface SavedCommand { id: string; sessionId: string; label: string | null; command: string; position: number }

export interface CommandRepository {
  list(sessionId: string): Promise<SavedCommand[]>
  get(id: string): Promise<SavedCommand | null>
  add(sessionId: string, command: string, label?: string | null): Promise<SavedCommand>
  remove(id: string): Promise<void>
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
