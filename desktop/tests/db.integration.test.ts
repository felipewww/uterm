import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseEnvFile } from '../src/main/config'
import { migrate } from '../src/main/db/migrate'
import { MySqlSessionStore } from '../src/main/db/sessionStore'
import { SettingsStore, VoiceProfileStore } from '../src/main/db/miscStores'

// Integration test against the Docker MySQL. Uses the root account ONLY to create a
// throwaway database; the app code under test connects as a limited user.
const root = join(__dirname, '..', '..')
const envFile = join(root, '.env')
const env = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {}
const host = '127.0.0.1'
const port = Number(env.MYSQL_PORT ?? 33306)
let available = false
const dbName = `echo_term_test_${randomUUID().slice(0, 8)}`
const testUser = `t_${randomUUID().slice(0, 8)}`
const testPass = randomUUID()

async function rootConn() {
  return mysql.createConnection({ host, port, user: 'root', password: env.MYSQL_ROOT_PASSWORD, connectTimeout: 2000 })
}

beforeAll(async () => {
  try {
    const c = await rootConn()
    await c.query(`CREATE DATABASE \`${dbName}\``)
    await c.query(`CREATE USER '${testUser}'@'%' IDENTIFIED BY '${testPass}'`)
    await c.query(`GRANT ALL ON \`${dbName}\`.* TO '${testUser}'@'%'`)
    await c.end()
    available = true
  } catch { available = false }
})

afterAll(async () => {
  if (!available) return
  const c = await rootConn()
  await c.query(`DROP DATABASE IF EXISTS \`${dbName}\``)
  await c.query(`DROP USER IF EXISTS '${testUser}'@'%'`)
  await c.end()
})

describe.skipIf(!process.env.CI && !existsSync(envFile))('MySQL integration', () => {
  const cfg = () => ({ host, port, database: dbName, user: testUser, password: testPass })
  const dir = join(root, 'database', 'migrations')

  it('applies migrations once and is idempotent', async (ctx) => {
    if (!available) return ctx.skip()
    const first = await migrate(cfg(), dir)
    expect(first.applied.length).toBeGreaterThanOrEqual(2)
    const second = await migrate(cfg(), dir)
    expect(second.applied).toEqual([])
    expect(second.alreadyApplied).toEqual(first.applied)
  }, 60_000) // five migrations of DDL on a fresh database take a few seconds

  it('persists sessions, enforces unique native ids per agent, finds by native id', async (ctx) => {
    if (!available) return ctx.skip()
    const pool = mysql.createPool({ host, port, ...{ user: testUser, password: testPass, database: dbName }, timezone: 'Z' })
    const store = new MySqlSessionStore(pool as never)
    const a = await store.create({ agentType: 'claude', title: 'Auth work', workingDirectory: '/tmp/x' })
    const b = await store.create({ agentType: 'claude', title: 'Other', workingDirectory: '/tmp/x' })
    expect(await store.setNativeSessionId(a.id, 'native-1')).toBe('ok')
    expect(await store.setNativeSessionId(b.id, 'native-1')).toBe('duplicate')
    const c = await store.create({ agentType: 'codex', title: 'Codex', workingDirectory: '/tmp/x' })
    expect(await store.setNativeSessionId(c.id, 'native-1')).toBe('ok') // different agent: allowed
    expect((await store.findByNative('claude', 'native-1'))?.id).toBe(a.id)
    await store.update(a.id, { title: 'Renamed', foregroundVoiceMode: 'conversational', playbackSpeed: 1.25 })
    const got = (await store.get(a.id))!
    expect(got).toMatchObject({ title: 'Renamed', foregroundVoiceMode: 'conversational', playbackSpeed: 1.25, backgroundVoiceMode: null })
    expect(got.englishCoach).toBeNull() // follows the global setting until the chat chooses
    await store.update(a.id, { englishCoach: false })
    expect((await store.get(a.id))!.englishCoach).toBe(false)
    await store.update(a.id, { englishCoach: true })
    expect((await store.get(a.id))!.englishCoach).toBe(true)
    await store.update(a.id, { englishCoach: null })
    expect((await store.get(a.id))!.englishCoach).toBeNull()
    expect((await store.list()).map((x) => x.id)).toContain(a.id)
    await store.delete(c.id)
    expect(await store.get(c.id)).toBeNull()
    const cols = ((await pool.query('SHOW COLUMNS FROM sessions')) as unknown as [Array<{ Field: string }>])[0].map((r) => r.Field)
    expect(cols).not.toContain('archived_at') // archiving was removed (migration 0009)
    await pool.end()
  })

  it('stores settings and voice profiles with FK safety', async (ctx) => {
    if (!available) return ctx.skip()
    const pool = mysql.createPool({ host, port, user: testUser, password: testPass, database: dbName })
    const settings = new SettingsStore(pool as never)
    expect((await settings.load()).defaultForegroundMode).toBe('balanced')
    await settings.save({ defaultForegroundMode: 'conversational', globalMute: true })
    expect(await settings.load()).toMatchObject({ defaultForegroundMode: 'conversational', globalMute: true })
    const voices = new VoiceProfileStore(pool as never)
    expect((await voices.list()).map((v) => v.id)).toContain('default')
    await voices.remove('default')
    expect((await voices.list()).map((v) => v.id)).toContain('default')
    await pool.end()
  })
})
