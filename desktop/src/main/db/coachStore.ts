export interface CoachEntry { sessionId: string; eventId: string | null; original: string; natural: string }
export interface CoachHistory { record(e: CoachEntry): Promise<void> }

export class MemoryCoachHistory implements CoachHistory {
  protected rows: CoachEntry[] = []
  all(): CoachEntry[] { return this.rows }
  async record(e: CoachEntry) { this.rows.push(e) }
}
