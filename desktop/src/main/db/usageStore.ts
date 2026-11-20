import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import type { UsageRow, UsageSummary } from '@shared/types'
import type { Usage } from '../voice/cloud'
import type { Pool } from './pool'

export interface UsageRecord extends Usage { costUsd: number | null; sessionId?: string | null; at?: number }

export interface UsageRepository {
  record(u: UsageRecord): Promise<void>
  summary(now?: Date): Promise<UsageSummary>
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

/** Used when MySQL is down, and in tests. Lost on exit. */
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

export class MySqlUsageStore implements UsageRepository {
  constructor(private pool: Pool) {}

  async record(u: UsageRecord): Promise<void> {
    await this.pool.execute(
      'INSERT INTO api_usage (id, provider, model, kind, chars, audio_seconds, input_tokens, output_tokens, cost_usd, session_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [randomUUID(), u.provider, u.model, u.kind, u.chars ?? null, u.audioSeconds ?? null, u.inputTokens ?? null, u.outputTokens ?? null, u.costUsd, u.sessionId ?? null])
  }

  async summary(now = new Date()): Promise<UsageSummary> {
    const q = async (since: Date | null): Promise<UsageRow[]> => {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT provider, kind, COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(audio_seconds),0) secs, COALESCE(SUM(chars),0) chars, SUM(cost_usd IS NULL) unpriced
         FROM api_usage ${since ? 'WHERE created_at >= ?' : ''} GROUP BY provider, kind ORDER BY provider, kind`, since ? [since] : [])
      return rows.map((r) => ({ provider: r.provider, kind: r.kind, calls: Number(r.calls), costUsd: Number(r.cost), audioSeconds: Number(r.secs), chars: Number(r.chars), unpriced: Number(r.unpriced) }))
    }
    return { today: await q(startOfDay(now)), month: await q(startOfMonth(now)), all: await q(null) }
  }
}
