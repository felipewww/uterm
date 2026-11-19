import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import type { DbConfig } from '../config'

export interface MigrationResult { applied: string[]; alreadyApplied: string[] }

/** Applies database/migrations/*.sql in filename order. Idempotent; guarded by a named lock. */
export async function migrate(cfg: DbConfig, migrationsDir: string): Promise<MigrationResult> {
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database,
    multipleStatements: true, connectTimeout: 5000
  })
  try {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version VARCHAR(128) NOT NULL PRIMARY KEY,
         applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       ) ENGINE=InnoDB`
    )
    const [lock] = await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('echo_term_migrations', 30) AS got")
    if (lock[0]?.got !== 1) throw new Error('could not acquire migration lock')
    try {
      const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT version FROM schema_migrations')
      const done = new Set(rows.map((r) => String(r.version)))
      const files = readdirSync(migrationsDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
      const result: MigrationResult = { applied: [], alreadyApplied: [] }
      for (const f of files) {
        if (done.has(f)) { result.alreadyApplied.push(f); continue }
        await conn.query(readFileSync(join(migrationsDir, f), 'utf8'))
        await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [f])
        result.applied.push(f)
      }
      return result
    } finally {
      await conn.query("SELECT RELEASE_LOCK('echo_term_migrations')")
    }
  } finally {
    await conn.end()
  }
}
