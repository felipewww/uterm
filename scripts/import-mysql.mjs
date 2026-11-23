#!/usr/bin/env node
// One-time import of the old Docker MySQL data into uTerm's local SQLite file. Safe to re-run: rows that already exist are skipped.
// Needs mysql2 (no longer an app dependency):  cd desktop && npm i --no-save mysql2
// Usage: node scripts/import-mysql.mjs [path/to/uterm.db]   (MySQL settings come from the repo's .env, as before)
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] ?? join(homedir(), '.config', 'echo-term-desktop', 'data', 'uterm.db')
let mysql
try { mysql = createRequire(join(root, 'desktop', 'package.json'))('mysql2/promise') } catch { console.error('mysql2 is missing: run  cd desktop && npm i --no-save mysql2'); process.exit(1) }

const env = { ...process.env }
const envFile = join(root, '.env')
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
if (!env.ECHO_TERM_DB_PASSWORD) { console.error('No MySQL password configured (ECHO_TERM_DB_PASSWORD): nothing to import'); process.exit(1) }

// the SQLite schema lives in the app (single source of truth)
const src = readFileSync(join(root, 'desktop', 'src', 'main', 'db', 'sqliteStore.ts'), 'utf8')
const schema = /const SCHEMA = `([\s\S]*?)`/.exec(src)?.[1]
const version = Number(/const SCHEMA_VERSION = (\d+)/.exec(src)?.[1])
if (!schema || !version) { console.error('Could not read the SQLite schema'); process.exit(1) }

mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
const lite = new DatabaseSync(target)
lite.exec('PRAGMA journal_mode = WAL;')
if (Number(lite.prepare('PRAGMA user_version').get().user_version) < version) { lite.exec(schema); lite.exec(`PRAGMA user_version = ${version}`) }

const conn = await mysql.createConnection({
  host: env.ECHO_TERM_DB_HOST ?? '127.0.0.1', port: Number(env.ECHO_TERM_DB_PORT ?? 33306),
  user: env.ECHO_TERM_DB_USER ?? 'echo_term', password: env.ECHO_TERM_DB_PASSWORD, database: env.ECHO_TERM_DB_NAME ?? 'echo_term',
  dateStrings: false
})

const ms = (v) => (v instanceof Date ? v.getTime() : v === null || v === undefined ? null : Number(v))
const num = (v) => (v === null || v === undefined ? null : Number(v))
const bool = (v) => (v === null || v === undefined ? null : v ? 1 : 0)
const json = (v) => (typeof v === 'string' ? v : JSON.stringify(v))

// [table, select, insert columns, mapper]
const plan = [
  ['session_folders', 'SELECT * FROM session_folders', ['id', 'name', 'parent_id', 'created_at'], (r) => [r.id, r.name, r.parent_id, ms(r.created_at)]],
  ['sessions', 'SELECT * FROM sessions', ['id', 'agent_type', 'native_session_id', 'title', 'working_directory', 'transcript_path', 'voice_profile_id', 'playback_speed', 'foreground_voice_mode', 'background_voice_mode', 'created_at', 'last_activity_at', 'folder_id', 'config_dir', 'english_coach', 'last_cwd'],
    (r) => [r.id, r.agent_type, r.native_session_id, r.title, r.working_directory, r.transcript_path, r.voice_profile_id, num(r.playback_speed), r.foreground_voice_mode, r.background_voice_mode, ms(r.created_at), ms(r.last_activity_at), r.folder_id, r.config_dir, bool(r.english_coach), r.last_cwd]],
  ['agent_events', 'SELECT * FROM agent_events', ['id', 'session_id', 'event_type', 'turn_id', 'payload', 'occurred_at'], (r) => [r.id, r.session_id, r.event_type, r.turn_id, json(r.payload), ms(r.occurred_at)]],
  ['spoken_messages', 'SELECT * FROM spoken_messages', ['id', 'session_id', 'event_id', 'voice_profile_id', 'priority', 'text', 'created_at'], (r) => [r.id, r.session_id, r.event_id, r.voice_profile_id, num(r.priority), r.text, ms(r.spoken_at)]],
  ['english_history', 'SELECT * FROM english_history', ['id', 'session_id', 'event_id', 'original', 'natural_text', 'created_at'], (r) => [r.id, r.session_id, r.event_id, r.original, r.natural_text, ms(r.created_at)]],
  ['api_usage', 'SELECT * FROM api_usage', ['id', 'provider', 'model', 'kind', 'chars', 'audio_seconds', 'input_tokens', 'output_tokens', 'cost_usd', 'session_id', 'created_at'],
    (r) => [r.id, r.provider, r.model, r.kind, num(r.chars), num(r.audio_seconds), num(r.input_tokens), num(r.output_tokens), num(r.cost_usd), r.session_id, ms(r.created_at)]],
  ['saved_commands', 'SELECT * FROM saved_commands', ['id', 'session_id', 'label', 'command', 'position', 'created_at'], (r) => [r.id, r.session_id, r.label, r.command, num(r.position) ?? 0, ms(r.created_at)]],
  ['settings', 'SELECT * FROM settings', ['setting_key', 'setting_value'], (r) => [r.setting_key, json(r.setting_value)]]
]

lite.exec('BEGIN')
try {
  for (const [table, select, cols, map] of plan) {
    const [rows] = await conn.query(select)
    const stmt = lite.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    let added = 0
    for (const r of rows) added += Number(stmt.run(...map(r)).changes)
    console.log(`${table}: ${added} of ${rows.length} rows imported`)
  }
  lite.exec('COMMIT')
} catch (err) { lite.exec('ROLLBACK'); console.error('Import failed, nothing was written:', err.message); process.exitCode = 1 }
await conn.end(); lite.close()
if (!process.exitCode) console.log(`Done: ${target}`)
