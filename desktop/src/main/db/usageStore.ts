import type { UsageRow, UsageSummary } from '@shared/types'
import type { Usage } from '../voice/cloud'

export interface UsageRecord extends Usage { costUsd: number | null; sessionId?: string | null; at?: number }

export interface UsageRepository {
  record(u: UsageRecord): Promise<void>
  summary(now?: Date): Promise<UsageSummary>
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

/** Used when the local database cannot be opened, and in tests. Lost on exit. */
export class MemoryUsageStore implements UsageRepository {
  protected rows: UsageRecord[] = []
  async record(u: UsageRecord) { this.rows.push({ ...u, at: u.at ?? Date.now() }) }
  async summary(now = new Date()): Promise<UsageSummary> {
    const agg = (since: number): UsageRow[] => {
      const m = new Map<string, UsageRow>()
      for (const r of this.rows.filter((x) => (x.at ?? 0) >= since)) {
        const k = `${r.provider}|${r.kind}`
        const row = m.get(k) ?? { provider: r.provider, kind: r.kind, calls: 0, costUsd: 0, audioSeconds: 0, chars: 0, unpriced: 0 }
        row.calls++; row.costUsd += r.costUsd ?? 0; row.audioSeconds += r.audioSeconds ?? 0; row.chars += r.chars ?? 0; if (r.costUsd === null) row.unpriced++
        m.set(k, row)
      }
      return [...m.values()]
    }
    return { today: agg(startOfDay(now).getTime()), month: agg(startOfMonth(now).getTime()), all: agg(0) }
  }
}
