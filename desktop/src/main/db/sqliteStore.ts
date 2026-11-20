import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { DEFAULT_SETTINGS, type AgentType, type AppSettings, type FolderRecord, type SessionRecord, type VoiceMode } from '@shared/types'
import type { AnyAgentEvent } from '@shared/events'
import type { UsageRow, UsageSummary } from '@shared/types'
import type { CoachEntry, CoachHistory } from './coachStore'
import type { CommandRepository, SavedCommand } from './commandStore'
import { PERSISTED, type EventRepo, type RecentEvent, type SettingsRepo } from './miscStores'
import type { NewSession, SessionRepository } from './sessionStore'
import type { UsageRecord, UsageRepository } from './usageStore'

/**
 * The local database used when MySQL is not configured (for example the macOS build, which ships without Docker). One SQLite file,
 * from Node's built-in `node:sqlite`: no native module to build, real queries, atomic writes. Same data as the MySQL schema, simplified.
 */
const SCHEMA_VERSION = 1
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, native_session_id TEXT, title TEXT NOT NULL, working_directory TEXT NOT NULL,
  transcript_path TEXT, voice_profile_id TEXT, playback_speed REAL, foreground_voice_mode TEXT, background_voice_mode TEXT,
  created_at INTEGER NOT NULL, last_activity_at INTEGER NOT NULL, folder_id TEXT, config_dir TEXT, english_coach INTEGER, last_cwd TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sessions_native ON sessions(agent_type, native_session_id) WHERE native_session_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS session_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_type TEXT NOT NULL, turn_id TEXT, payload TEXT NOT NULL, occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_session ON agent_events(session_id, occurred_at);
CREATE TABLE IF NOT EXISTS spoken_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_id TEXT NOT NULL, voice_profile_id TEXT, priority INTEGER, text TEXT, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_spoken_event ON spoken_messages(event_id);
CREATE TABLE IF NOT EXISTS english_history (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, event_id TEXT, original TEXT NOT NULL, natural_text TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_english_event ON english_history(event_id);
CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT, kind TEXT NOT NULL, chars INTEGER, audio_seconds REAL, input_tokens INTEGER,
  output_tokens INTEGER, cost_usd REAL, session_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usage_created ON api_usage(created_at);
CREATE TABLE IF NOT EXISTS saved_commands (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, label TEXT, command TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_commands_session ON saved_commands(session_id, position);
CREATE TABLE IF NOT EXISTS settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL);
`

type Row = Record<string, unknown>

export class LocalDb {
  readonly db: DatabaseSync
  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    const v = Number((this.db.prepare('PRAGMA user_version').get() as Row).user_version)
    if (v < SCHEMA_VERSION) { this.db.exec(SCHEMA); this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`) }
  }
  all(sql: string, ...p: SQLInputValue[]): Row[] { return this.db.prepare(sql).all(...p) as Row[] }
  one(sql: string, ...p: SQLInputValue[]): Row | undefined { return this.db.prepare(sql).get(...p) as Row | undefined }
  run(sql: string, ...p: SQLInputValue[]): void { this.db.prepare(sql).run(...p) }
  close(): void { try { this.db.close() } catch { /* already closed */ } }
}

const sessionOf = (r: Row): SessionRecord => ({
  id: r.id as string, agentType: r.agent_type as AgentType, nativeSessionId: (r.native_session_id as string) ?? null, title: r.title as string,
  workingDirectory: r.working_directory as string, transcriptPath: (r.transcript_path as string) ?? null, voiceProfileId: (r.voice_profile_id as string) ?? null,
  playbackSpeed: r.playback_speed === null ? null : Number(r.playback_speed),
  foregroundVoiceMode: (r.foreground_voice_mode as VoiceMode) ?? null, backgroundVoiceMode: (r.background_voice_mode as VoiceMode) ?? null,
  createdAt: Number(r.created_at), lastActivityAt: Number(r.last_activity_at), folderId: (r.folder_id as string) ?? null, configDir: (r.config_dir as string) ?? null,
  englishCoach: r.english_coach === null || r.english_coach === undefined ? null : !!r.english_coach, lastCwd: (r.last_cwd as string) ?? null
})
const COLUMN: Record<string, string> = {
  title: 'title', voiceProfileId: 'voice_profile_id', playbackSpeed: 'playback_speed', foregroundVoiceMode: 'foreground_voice_mode',
  backgroundVoiceMode: 'background_voice_mode', transcriptPath: 'transcript_path', englishCoach: 'english_coach', lastCwd: 'last_cwd'
}

export class SqliteSessionRepo implements SessionRepository {
  constructor(private d: LocalDb) {}
  async create(s: NewSession): Promise<SessionRecord> {
    const id = randomUUID(); const now = Date.now()
    this.d.run('INSERT INTO sessions (id, agent_type, native_session_id, title, working_directory, transcript_path, voice_profile_id, config_dir, created_at, last_activity_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, s.agentType, s.nativeSessionId ?? null, s.title, s.workingDirectory, s.transcriptPath ?? null, s.voiceProfileId ?? null, s.configDir ?? null, now, now)
    return (await this.get(id))!
  }
  async get(id: string) { const r = this.d.one('SELECT * FROM sessions WHERE id = ?', id); return r ? sessionOf(r) : null }
  async list() { return this.d.all('SELECT * FROM sessions ORDER BY last_activity_at DESC').map(sessionOf) }
  async update(id: string, patch: Parameters<SessionRepository['update']>[1]) {
    const sets: string[] = []; const vals: SQLInputValue[] = []
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMN[k]
      if (!col || v === undefined) continue
      sets.push(`${col} = ?`); vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as SQLInputValue))
    }
    if (sets.length) this.d.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
  }
  async setNativeSessionId(id: string, nativeId: string): Promise<'ok' | 'duplicate'> {
    try { this.d.run('UPDATE sessions SET native_session_id = ? WHERE id = ?', nativeId, id); return 'ok' } catch (e) { if (/UNIQUE/i.test((e as Error).message)) return 'duplicate'; throw e }
  }
  async touch(id: string, at = Date.now()) { this.d.run('UPDATE sessions SET last_activity_at = ? WHERE id = ?', at, id) }
  async delete(id: string) {
    this.d.run('DELETE FROM agent_events WHERE session_id = ?', id); this.d.run('DELETE FROM spoken_messages WHERE session_id = ?', id)
    this.d.run('DELETE FROM english_history WHERE session_id = ?', id); this.d.run('DELETE FROM saved_commands WHERE session_id = ?', id)
    this.d.run('DELETE FROM sessions WHERE id = ?', id)
  }
  async findByNative(agent: AgentType, nativeId: string) { const r = this.d.one('SELECT * FROM sessions WHERE agent_type = ? AND native_session_id = ?', agent, nativeId); return r ? sessionOf(r) : null }
  async listFolders(): Promise<FolderRecord[]> {
    return this.d.all('SELECT * FROM session_folders ORDER BY created_at, name').map((r) => ({ id: r.id as string, name: r.name as string, parentId: (r.parent_id as string) ?? null, createdAt: Number(r.created_at) }))
  }
  async createFolder(name: string, parentId: string | null = null): Promise<FolderRecord> {
    const f = { id: randomUUID(), name, parentId, createdAt: Date.now() }
    this.d.run('INSERT INTO session_folders (id, name, parent_id, created_at) VALUES (?,?,?,?)', f.id, name, parentId, f.createdAt)
    return f
  }
  async renameFolder(id: string, name: string) { this.d.run('UPDATE session_folders SET name = ? WHERE id = ?', name, id) }
  async setFolderParent(id: string, parentId: string | null) { this.d.run('UPDATE session_folders SET parent_id = ? WHERE id = ?', parentId, id) }
  async deleteFolder(id: string) {
    const parent = (this.d.one('SELECT parent_id FROM session_folders WHERE id = ?', id)?.parent_id as string | null | undefined) ?? null
    this.d.run('UPDATE session_folders SET parent_id = ? WHERE parent_id = ?', parent, id)
    this.d.run('UPDATE sessions SET folder_id = ? WHERE folder_id = ?', parent, id)
    this.d.run('DELETE FROM session_folders WHERE id = ?', id)
  }
  async setFolder(sessionId: string, folderId: string | null) { this.d.run('UPDATE sessions SET folder_id = ? WHERE id = ?', folderId, sessionId) }
}

export class SqliteEventStore implements EventRepo {
  constructor(private d: LocalDb) {}
  async record(e: AnyAgentEvent) {
    if (!PERSISTED.has(e.type)) return
    this.d.run('INSERT OR IGNORE INTO agent_events (id, session_id, event_type, turn_id, payload, occurred_at) VALUES (?,?,?,?,?,?)',
      e.id, e.sessionId, e.type, e.turnId ?? null, JSON.stringify(e.payload).slice(0, 20000), e.timestamp)
  }
  async recent(sessionId: string, limit = 100): Promise<RecentEvent[]> {
    const rows = this.d.all(
      `SELECT e.id, e.event_type, e.payload, e.occurred_at,
              EXISTS(SELECT 1 FROM spoken_messages m WHERE m.event_id = e.id) AS spoken,
              (SELECT h.natural_text FROM english_history h WHERE h.event_id = e.id LIMIT 1) AS natural_text
       FROM agent_events e WHERE e.session_id = ? ORDER BY e.occurred_at DESC LIMIT ?`, sessionId, limit)
    return rows.reverse().map((r) => {
      let payload: unknown = null
      try { payload = JSON.parse(r.payload as string) } catch { /* truncated payload: show nothing rather than fail */ }
      return { id: r.id as string, type: r.event_type as string, at: Number(r.occurred_at), payload, spoken: !!r.spoken, natural: (r.natural_text as string) ?? undefined }
    })
  }
  async recordSpoken(sessionId: string, eventId: string, voiceId: string | null, priority: number, text: string) {
    this.d.run('INSERT INTO spoken_messages (id, session_id, event_id, voice_profile_id, priority, text, created_at) VALUES (?,?,?,?,?,?,?)', randomUUID(), sessionId, eventId, voiceId, priority, text, Date.now())
  }
}

export class SqliteCoachHistory implements CoachHistory {
  constructor(private d: LocalDb) {}
  async record(e: CoachEntry) { this.d.run('INSERT INTO english_history (id, session_id, event_id, original, natural_text, created_at) VALUES (?,?,?,?,?,?)', randomUUID(), e.sessionId, e.eventId, e.original, e.natural, Date.now()) }
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1).getTime()
export class SqliteUsageStore implements UsageRepository {
  constructor(private d: LocalDb) {}
  async record(u: UsageRecord) {
    this.d.run('INSERT INTO api_usage (id, provider, model, kind, chars, audio_seconds, input_tokens, output_tokens, cost_usd, session_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      randomUUID(), u.provider, u.model ?? null, u.kind, u.chars ?? null, u.audioSeconds ?? null, u.inputTokens ?? null, u.outputTokens ?? null, u.costUsd, u.sessionId ?? null, u.at ?? Date.now())
  }
  async summary(now = new Date()): Promise<UsageSummary> {
    const q = (since: number): UsageRow[] => this.d.all(
      `SELECT provider, kind, COUNT(*) calls, COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(audio_seconds),0) secs, COALESCE(SUM(chars),0) chars, SUM(cost_usd IS NULL) unpriced
       FROM api_usage WHERE created_at >= ? GROUP BY provider, kind ORDER BY provider, kind`, since)
      .map((r) => ({ provider: r.provider as string, kind: r.kind as string, calls: Number(r.calls), costUsd: Number(r.cost), audioSeconds: Number(r.secs), chars: Number(r.chars), unpriced: Number(r.unpriced) })) as UsageRow[]
    return { today: q(startOfDay(now)), month: q(startOfMonth(now)), all: q(0) }
  }
}

export class SqliteCommandStore implements CommandRepository {
  constructor(private d: LocalDb) {}
  private of = (r: Row): SavedCommand => ({ id: r.id as string, sessionId: r.session_id as string, label: (r.label as string) ?? null, command: r.command as string, position: Number(r.position) })
  async list(sessionId: string) { return this.d.all('SELECT * FROM saved_commands WHERE session_id = ? ORDER BY position, created_at', sessionId).map(this.of) }
  async get(id: string) { const r = this.d.one('SELECT * FROM saved_commands WHERE id = ?', id); return r ? this.of(r) : null }
  async add(sessionId: string, command: string, label: string | null = null) {
    const id = randomUUID()
    const position = Number(this.d.one('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM saved_commands WHERE session_id = ?', sessionId)?.p ?? 0)
    this.d.run('INSERT INTO saved_commands (id, session_id, label, command, position, created_at) VALUES (?,?,?,?,?,?)', id, sessionId, label, command, position, Date.now())
    return { id, sessionId, label, command, position }
  }
  async remove(id: string) { this.d.run('DELETE FROM saved_commands WHERE id = ?', id) }
}

export class SqliteSettings implements SettingsRepo {
  constructor(private d: LocalDb) {}
  async load(): Promise<AppSettings> {
    const stored: Record<string, unknown> = {}
    for (const r of this.d.all('SELECT setting_key, setting_value FROM settings')) { try { stored[r.setting_key as string] = JSON.parse(r.setting_value as string) } catch { /* ignore a bad row */ } }
    return { ...DEFAULT_SETTINGS, ...stored } as AppSettings
  }
  async save(patch: Partial<AppSettings>) {
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) this.d.run('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value', k, JSON.stringify(v))
  }
  async remove(keys: string[]) { for (const k of keys) this.d.run('DELETE FROM settings WHERE setting_key = ?', k) }
}
