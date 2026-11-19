import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import type { AnyAgentEvent } from '@shared/events'
import { schemas } from '@shared/ipc'
import { DEFAULT_SETTINGS, type AgentType, type AppSettings, type ServiceStatus, type SessionView } from '@shared/types'
import { ClaudeCodeAdapter } from './agents/claude'
import { CodexAdapter } from './agents/codex'
import { KiroAdapter } from './agents/kiro'
import { dbConfigFromEnv, findRepoRoot, loadEnv, socketPath } from './config'
import { migrate } from './db/migrate'
import { EventStore, SettingsStore, VoiceProfileStore } from './db/miscStores'
import { createPool, type Pool } from './db/pool'
import { MemorySessionRepo } from './db/memoryStore'
import { MySqlSessionStore, type SessionRepository } from './db/sessionStore'
import { EventBus } from './events/eventBus'
import { HookServer } from './hooks/hookServer'
import { listImportable } from './importer'
import { PtyManager } from './pty/ptyManager'
import { nodePtyFactory } from './pty/nodePtyFactory'
import { SessionManager } from './sessionManager'
import { SPEECH_INSTRUCTIONS } from './speechInstructions'
import { claudeProfiles } from './agents/claudeProfiles'
import { SttClient } from './voice/sttClient'
import { TtsClient } from './voice/ttsClient'
import { VoiceCoordinator } from './voice/voiceCoordinator'

let win: BrowserWindow | null = null
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let pool: Pool | null = null
let dbOk = false
let quitting = false
const pendingAudio = new Map<string, () => void>()
let speakingSessionId: string | null = null

const send = (channel: string, payload?: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload) }
const pendingNotices: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = []
// Notices raised during bootstrap (before the window exists) are delivered once the page has loaded.
const notice = (level: 'info' | 'warn' | 'error', message: string) => {
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) send('notice', { level, message })
  else pendingNotices.push({ level, message })
}

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const r = schema.safeParse(payload)
  if (!r.success) throw new Error('Invalid request')
  return r.data
}

async function bootstrap(): Promise<{ onFocusChange: () => void; hasRunning: () => boolean }> {
  // Packaged builds ship hooks/ and database/ as extraResources (outside the asar).
  const root = app.isPackaged ? process.resourcesPath : findRepoRoot(app.getAppPath())
  const env = loadEnv(root)
  const dbCfg = dbConfigFromEnv(env)
  let repo: SessionRepository = new MemorySessionRepo()
  let settingsStore: SettingsStore | null = null
  let eventStore: EventStore | null = null
  let voiceStore: VoiceProfileStore | null = null

  if (dbCfg && root) {
    try {
      await migrate(dbCfg, join(root, 'database', 'migrations'))
      pool = createPool(dbCfg)
      repo = new MySqlSessionStore(pool)
      settingsStore = new SettingsStore(pool)
      eventStore = new EventStore(pool)
      voiceStore = new VoiceProfileStore(pool)
      settings = await settingsStore.load()
      dbOk = true
    } catch (err) {
      console.error('[db] unavailable:', (err as Error).message) // message only: never log credentials
    }
  }

  const bus = new EventBus()
  const stt = new SttClient(() => settings.sttUrl)
  const tts = new TtsClient(() => settings.ttsUrl)
  const repoRoot = root ?? process.cwd()

  const pty = new PtyManager(nodePtyFactory, {
    onData: (id, data) => send('pty:data', { id, data }),
    onExit: (id, code) => { sessions.onPtyExit(id, code); send('pty:exit', { id }) }
  })

  let dbWarned = false
  const sessions: SessionManager = new SessionManager({
    repo, pty, bus, socketPath: socketPath(),
    adapters: { claude: new ClaudeCodeAdapter(repoRoot), codex: new CodexAdapter(), kiro: new KiroAdapter() },
    settings: () => settings,
    speechInstructions: () => (settings.injectSpeechInstructions ? SPEECH_INSTRUCTIONS : null),
    onViewChanged: (v: SessionView) => send('session:view', { ...v, speaking: v.id === speakingSessionId }),
    onFoldersChanged: (f) => send('folders:changed', f),
    onSessionRemoved: (id) => send('session:removed', { id }),
    onPersistenceError: (m) => { if (!dbWarned) { dbWarned = true; notice('warn', m) } }
  })
  await sessions.load()
  if (!dbOk) notice('warn', 'MySQL is unavailable: sessions will not be saved this run. Terminals work normally. Run ./scripts/doctor.sh.')

  const voice = new VoiceCoordinator({
    getSession: (id) => sessions.getRecord(id),
    isMuted: (id) => sessions.isMuted(id),
    settings: () => settings,
    focus: () => ({ selectedSessionId: sessions.selected, windowFocused: !!win && win.isFocused() && !win.isMinimized() }),
    synthesize: (t, v, s) => tts.synthesize(t, v, s),
    play: (audio, speed, requestId) => new Promise<void>((resolve) => {
      const done = () => { pendingAudio.delete(requestId); clearTimeout(timer); resolve() }
      const timer = setTimeout(done, 120_000) // renderer never answered: don't wedge the queue
      pendingAudio.set(requestId, done)
      const copy = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength)
      send('audio:play', { requestId, data: copy, speed })
    }),
    stopPlayback: () => { send('audio:stop'); for (const done of [...pendingAudio.values()]) done() },
    onSpoken: (sid, eid, vid, prio, text) => { send('activity:spoken', { sessionId: sid, eventId: eid }); void eventStore?.recordSpoken(sid, eid, vid, prio, text).catch(() => undefined) },
    onState: (s) => {
      const prev = speakingSessionId
      speakingSessionId = s.speakingSessionId
      send('audio:state', s)
      for (const id of new Set([prev, s.speakingSessionId])) if (id) { const v = sessions.view(id, speakingSessionId); if (v) send('session:view', v) }
    },
    onError: (m) => notice('warn', m)
  })

  bus.subscribe((e: AnyAgentEvent) => {
    if (e.type !== 'ASSISTANT_MESSAGE_DELTA') send('activity:event', e)
    voice.onEvent(e)
    void eventStore?.record(e).catch(() => undefined)
  })

  const hookServer = new HookServer(socketPath(), (env) => sessions.handleHook(env as never))
  await hookServer.start()

  const requireSession = (id: string) => { if (!sessions.getRecord(id)) throw new Error('Unknown session'); return id }

  ipcMain.handle('sessions:list', () => sessions.views(speakingSessionId))
  ipcMain.handle('sessions:create', async (_e, p) => {
    const a = parse(schemas.create, p)
    return sessions.create({ agentType: a.agentType as AgentType, title: a.title, workingDirectory: a.workingDirectory, configDir: a.configDir ?? null })
  })
  ipcMain.handle('sessions:listImportable', () => listImportable())
  ipcMain.handle('sessions:import', async (_e, p) => {
    const a = parse(schemas.importSession, p)
    return sessions.importNative({ agentType: a.agentType as AgentType, nativeSessionId: a.nativeSessionId, workingDirectory: a.workingDirectory, title: a.title, configDir: a.configDir ?? null })
  })
  ipcMain.handle('sessions:start', async (_e, p) => { const a = parse(schemas.start, p); await sessions.start(requireSession(a.id), a.cols, a.rows) })
  ipcMain.handle('sessions:stop', async (_e, p) => { const a = parse(schemas.id, p); voice.queue.cancelSession(a.id); await sessions.stop(requireSession(a.id)) })
  ipcMain.handle('sessions:rename', (_e, p) => { const a = parse(schemas.rename, p); return sessions.rename(requireSession(a.id), a.title) })
  ipcMain.handle('sessions:delete', async (_e, p) => { const a = parse(schemas.id, p); voice.queue.cancelSession(a.id); await sessions.delete(requireSession(a.id)); voice.focusChanged() })
  ipcMain.handle('sessions:archive', (_e, p) => { const a = parse(schemas.archive, p); return sessions.archive(requireSession(a.id), a.archived) })
  ipcMain.handle('sessions:claudeProfiles', () => claudeProfiles())
  ipcMain.handle('folders:list', () => sessions.folderList())
  ipcMain.handle('folders:create', (_e, p) => { const a = parse(schemas.folderCreate, p); return sessions.createFolder(a.name, a.parentId ?? null) })
  ipcMain.handle('folders:move', (_e, p) => { const a = parse(schemas.folderMove, p); return sessions.moveFolder(a.id, a.parentId) })
  ipcMain.handle('folders:rename', (_e, p) => { const a = parse(schemas.folderRename, p); return sessions.renameFolder(a.id, a.name) })
  ipcMain.handle('folders:delete', (_e, p) => sessions.deleteFolder(parse(schemas.id, p).id))
  ipcMain.handle('sessions:moveToFolder', (_e, p) => { const a = parse(schemas.moveToFolder, p); return sessions.moveToFolder(requireSession(a.id), a.folderId) })
  ipcMain.handle('sessions:mute', (_e, p) => {
    const a = parse(schemas.mute, p); sessions.setMuted(requireSession(a.id), a.muted)
    if (a.muted) voice.queue.cancelSession(a.id)
  })
  ipcMain.handle('sessions:update', async (_e, p) => {
    const a = parse(schemas.sessionSettings, p)
    await sessions.updateSettings(requireSession(a.id), a.patch as never)
    voice.focusChanged()
  })
  ipcMain.handle('sessions:select', (_e, p) => {
    const a = p === null ? null : parse(schemas.id, p).id
    sessions.select(a); voice.focusChanged() // effective mode re-evaluated immediately
  })
  ipcMain.handle('sessions:activity', async (_e, p) => { const a = parse(schemas.id, p); return (await eventStore?.recent(a.id, 150)) ?? [] })
  ipcMain.handle('sessions:openInVscode', (_e, p) => {
    const a = parse(schemas.id, p); const rec = sessions.getRecord(requireSession(a.id))!
    // Fixed argv, no shell: the directory is one argument.
    const child = spawn('code', [rec.workingDirectory], { detached: true, stdio: 'ignore' })
    child.on('error', () => notice('error', 'Could not run the "code" command. Is VS Code on your PATH?'))
    child.unref()
  })
  ipcMain.handle('dialog:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle('pty:write', (_e, p) => { const a = parse(schemas.ptyWrite, p); return pty.write(a.id, a.data) })
  ipcMain.handle('pty:resize', (_e, p) => { const a = parse(schemas.ptyResize, p); pty.resize(a.id, a.cols, a.rows) })
  ipcMain.handle('pty:attach', (_e, p) => pty.scrollback(parse(schemas.id, p).id))

  ipcMain.handle('voice:recording', (_e, p) => {
    voice.queue.setPaused(parse(schemas.recording, p).recording) // avoid microphone feedback
  })
  ipcMain.handle('voice:transcribe', async (_e, wav: ArrayBuffer) => {
    if (!(wav instanceof ArrayBuffer) || wav.byteLength < 44 || wav.byteLength > 50_000_000) throw new Error('Invalid audio')
    return stt.transcribe(new Uint8Array(wav)) // audio lives in memory only; nothing is written to disk
  })
  ipcMain.handle('voice:send', (_e, p) => {
    const a = parse(schemas.send, p)
    return sessions.sendText(requireSession(a.id), a.text, { auto: a.auto, force: a.force })
  })
  ipcMain.handle('voice:stop', () => { voice.queue.cancelAll() })
  ipcMain.handle('voice:listen', (_e, p) => { const a = parse(schemas.listen, p); return voice.listen(requireSession(a.id), a.text, a.ref) })
  ipcMain.handle('voice:preview', (_e, p) => { voice.preview(parse(schemas.voicePreview, p).voiceId, 'Hello, this is how I sound when I give you an update.') })
  ipcMain.handle('audio:ended', (_e, p) => { pendingAudio.get(parse(schemas.audioEnded, p).requestId)?.() })

  ipcMain.handle('voices:list', async () => {
    try {
      const remote = await tts.listVoices()
      for (const v of remote) await voiceStore?.upsert(v).catch(() => undefined)
      return remote
    } catch { return (await voiceStore?.list().catch(() => null)) ?? [{ id: 'default', name: 'Default' }] }
  })
  ipcMain.handle('voices:create', async (_e, p: { name: string; wav: ArrayBuffer }) => {
    const { name } = parse(schemas.voiceCreate, { name: p.name })
    const v = await tts.createVoice(name, new Uint8Array(p.wav))
    await voiceStore?.upsert(v).catch(() => undefined)
    return v
  })
  ipcMain.handle('voices:delete', async (_e, p) => {
    const { voiceId } = parse(schemas.voiceDelete, p)
    await tts.deleteVoice(voiceId); await voiceStore?.remove(voiceId).catch(() => undefined)
  })

  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:save', async (_e, p) => {
    const patch = parse(schemas.settingsPatch, p)
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS && typeof v === typeof (DEFAULT_SETTINGS as never)[k]) clean[k] = v
    settings = { ...settings, ...clean } as AppSettings
    await settingsStore?.save(clean as Partial<AppSettings>).catch(() => notice('warn', 'Could not save settings to MySQL.'))
    send('settings:changed', settings)
    voice.focusChanged()
    return settings
  })

  ipcMain.handle('status:get', async (): Promise<ServiceStatus & { agents: Record<string, { installed: boolean; version?: string }>; capabilities: unknown }> => {
    const [s, t, claude, codex, kiro] = await Promise.all([stt.status(), tts.status(), new ClaudeCodeAdapter(repoRoot).detect(), new CodexAdapter().detect(), new KiroAdapter().detect()])
    return { stt: s.up, tts: t.up, ttsReady: t.ready, db: dbOk, agents: { claude, codex, kiro },
      capabilities: { claude: new ClaudeCodeAdapter(repoRoot).capabilities, codex: new CodexAdapter().capabilities, kiro: new KiroAdapter().capabilities } }
  })
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_e, p) => { clipboard.writeText(parse(schemas.text, p).text) })

  app.on('before-quit', (e) => {
    if (quitting) return
    if (sessions.runningCount() > 0) {
      e.preventDefault()
      send('app:confirm-quit')
      return
    }
    quitting = true
  })
  ipcMain.handle('app:quit-confirmed', async () => {
    quitting = true
    await sessions.stopAll()
    await hookServer.stop()
    await pool?.end().catch(() => undefined)
    app.quit()
  })

  return { onFocusChange: () => voice.focusChanged(), hasRunning: () => sessions.runningCount() > 0 }
}

// Window icon. Must be small (<= 192 px): Chromium on X11 silently drops larger ones, leaving the generic gear icon.
function appIcon(): Electron.NativeImage | undefined {
  const p = app.isPackaged ? join(process.resourcesPath, 'icon-window.png') : join(app.getAppPath(), 'build/icon-window.png')
  if (!existsSync(p)) return undefined
  const img = nativeImage.createFromPath(p)
  return img.isEmpty() ? undefined : img
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 560, backgroundColor: '#1e1e1e', title: 'Echo-Term', icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
    }
  })
  win.webContents.on('did-finish-load', () => { for (const n of pendingNotices.splice(0)) send('notice', n) })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  const { onFocusChange, hasRunning } = await bootstrap() // IPC handlers must exist before the renderer loads
  createWindow()
  // Closing the window with live agents asks first; minimizing never touches them.
  win?.on('close', (e) => {
    if (!quitting && hasRunning()) { e.preventDefault(); send('app:confirm-quit') }
  })
  win?.on('focus', onFocusChange)
  win?.on('blur', onFocusChange)
  win?.on('minimize', onFocusChange)
  win?.on('restore', onFocusChange)
}).catch((err) => { console.error('fatal:', err); app.exit(1) })

app.on('window-all-closed', () => { if (!quitting) app.quit() })
