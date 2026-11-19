#!/usr/bin/env node
// Applies database/migrations/*.sql using the application user from .env (never root).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'desktop', 'package.json'))
const mysql = require('mysql2/promise')

const env = { ...process.env }
const envFile = join(root, '.env')
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const conn = await mysql.createConnection({
  host: env.ECHO_TERM_DB_HOST ?? '127.0.0.1', port: Number(env.ECHO_TERM_DB_PORT ?? 33306),
  user: env.ECHO_TERM_DB_USER ?? 'echo_term', password: env.ECHO_TERM_DB_PASSWORD, database: env.ECHO_TERM_DB_NAME ?? 'echo_term',
  multipleStatements: true
})
await conn.query('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(128) NOT NULL PRIMARY KEY, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB')
await conn.query("SELECT GET_LOCK('echo_term_migrations', 30)")
const [rows] = await conn.query('SELECT version FROM schema_migrations')
const done = new Set(rows.map((r) => r.version))
let applied = 0
for (const f of readdirSync(join(root, 'database', 'migrations')).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  if (done.has(f)) continue
  await conn.query(readFileSync(join(root, 'database', 'migrations', f), 'utf8'))
  await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [f])
  console.log(`applied ${f}`); applied++
}
await conn.query("SELECT RELEASE_LOCK('echo_term_migrations')")
console.log(applied ? `${applied} migration(s) applied` : 'database is up to date')
await conn.end()
