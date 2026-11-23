import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, safeStorage, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import type { AnyAgentEvent } from '@shared/events'
import { schemas } from '@shared/ipc'
import { DEFAULT_SETTINGS, OLD_DEFAULT_RECORD_SHORTCUT, SPEECH_PROVIDERS, TTS_ENGINES, coachOnFor, type AgentType, type AppSettings, type ServiceStatus, type SessionView } from '@shared/types'
import { ClaudeCodeAdapter } from './agents/claude'
import { CodexAdapter } from './agents/codex'
import { KiroAdapter } from './agents/kiro'
import { findRepoRoot, readEnvFiles, readLegacyKeys, socketPath } from './config'
import type { EventRepo, SettingsRepo } from './db/miscStores'
import { LocalDb, SqliteCoachHistory, SqliteCommandStore, SqliteEventStore, SqliteSessionRepo, SqliteSettings, SqliteUsageStore } from './db/sqliteStore'
import { MemorySessionRepo } from './db/memoryStore'
import type { SessionRepository } from './db/sessionStore'
import { EventBus } from './events/eventBus'
import { HookServer } from './hooks/hookServer'
import { listImportable } from './importer'
import { PtyManager } from './pty/ptyManager'
import { nodePtyFactory } from './pty/nodePtyFactory'
import { SessionManager, setEnvScrub } from './sessionManager'
import { SPEECH_INSTRUCTIONS } from './speechInstructions'
import { claudeProfiles } from './agents/claudeProfiles'
import { SECRET_NAMES, SecretStore, type SecretName } from './secrets'
import { ShellAdapter } from './agents/shell'
import { SystemSampler } from './system'
import { popOut } from './externalTerminal'
import { readOpenTabs, writeOpenTabs } from './openTabs'
import { userShell } from './agents/shell'
import { MemoryCommandStore, type CommandRepository } from './db/commandStore'
import { NativeStt } from './voice/nativeStt'
import { SystemTts } from './voice/systemTts'
import { SpeechRouter, selfTest } from './voice/speechRouter'
import { listModels, type CloudProvider } from './voice/cloud'
import { EnglishCoach, shouldCoach } from './voice/coach'
import { MemoryCoachHistory, type CoachHistory } from './db/coachStore'
import { MemoryUsageStore, type UsageRepository } from './db/usageStore'
import { TtsClient } from './voice/ttsClient'
import { VoiceCoordinator } from './voice/voiceCoordinator'

let win: BrowserWindow | null = null
let settings: AppSettings = { ...DEFAULT_SETTINGS }
let quitting = false
const pendingAudio = new Map<string, () => void>()
/** The player can report a message as finished (e.g. paused for a long time) before main has pushed its last chunk. */
const endedEarly = new Set<string>()
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

// The app was renamed (echo-term-desktop -> uterm-desktop): keep using the old user-data folder so saved theme, layout and sizes survive.
{
  const legacyData = join(app.getPath('appData'), 'echo-term-desktop')
  if (existsSync(legacyData)) app.setPath('userData', legacyData)
}

async function bootstrap(): Promise<{ onFocusChange: () => void; hasRunning: () => boolean }> {
  // Packaged builds ship hooks/ and database/ as extraResources (outside the asar).
  const root = app.isPackaged ? process.resourcesPath : findRepoRoot(app.getAppPath())
  setEnvScrub(readEnvFiles(root)) // keys from old .env files must never reach an agent or a terminal
  let repo: SessionRepository = new MemorySessionRepo()
  let settingsStore: SettingsRepo | null = null
  let localDb: LocalDb | null = null
  let eventStore: EventRepo | null = null
  let usageStore: UsageRepository = new MemoryUsageStore()
  let coachHistory: CoachHistory = new MemoryCoachHistory()
  let commandStore: CommandRepository = new MemoryCommandStore()

  // One local SQLite file, the same in development and in the installed app.
  try {
    localDb = new LocalDb(join(app.getPath('userData'), 'data', 'uterm.db'))
    repo = new SqliteSessionRepo(localDb)
    settingsStore = new SqliteSettings(localDb)
    eventStore = new SqliteEventStore(localDb)
    usageStore = new SqliteUsageStore(localDb)
    coachHistory = new SqliteCoachHistory(localDb)
    commandStore = new SqliteCommandStore(localDb)
    settings = await settingsStore.load()
    // Earlier macOS builds defaulted to Ctrl+Shift+Space: carry the unchanged default over to Cmd+Shift+Space
    if (process.platform === 'darwin' && settings.recordShortcut === OLD_DEFAULT_RECORD_SHORTCUT) { settings.recordShortcut = 'Meta+Shift+Space'; await settingsStore.save({ recordShortcut: settings.recordShortcut }) }
  } catch (err) {
    console.error('[local db] unavailable, running from memory:', (err as Error).message)
    localDb = null
    notice('warn', 'The local database could not be opened, so this run keeps its history in memory only.')
  }

  const bus = new EventBus()
  const tts = new TtsClient(() => settings.ttsUrl)
  const repoRoot = root ?? process.cwd()

  const pty = new PtyManager(nodePtyFactory, {
    onData: (id, data) => send('pty:data', { id, data }),
    onExit: (id, code) => { sessions.onPtyExit(id, code); send('pty:exit', { id }) }
  })

  let dbWarned = false
  const sessions: SessionManager = new SessionManager({
    repo, pty, bus, socketPath: socketPath(),
    adapters: { claude: new ClaudeCodeAdapter(repoRoot), codex: new CodexAdapter(), kiro: new KiroAdapter(), shell: new ShellAdapter() },
    settings: () => settings,
    speechInstructions: () => (settings.injectSpeechInstructions ? SPEECH_INSTRUCTIONS : null),
    onViewChanged: (v: SessionView) => send('session:view', { ...v, speaking: v.id === speakingSessionId }),
    onFoldersChanged: (f) => send('folders:changed', f),
    onSessionRemoved: (id) => send('session:removed', { id }),
    onPersistenceError: (m) => { if (!dbWarned) { dbWarned = true; notice('warn', m) } }
  })
  await sessions.load()

  // Cloud keys are typed in Settings and kept encrypted by the operating system (never in the database, never passed to agents). Only the app process reads them.
  const secrets = new SecretStore(join(app.getPath('userData'), 'secrets.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (t) => safeStorage.encryptString(t), decrypt: (b) => safeStorage.decryptString(b)
  })
  const migratedMark = join(app.getPath('userData'), 'keys-from-env.done')
  if (!existsSync(migratedMark)) { // once: keys that used to be in a .env file move into the encrypted store
    try {
      const legacy = readLegacyKeys(root); let moved = 0
      for (const n of SECRET_NAMES) { const v = legacy[n]; if (v && !secrets.has(n)) { if (secrets.set(n, v)) moved++ } }
      if (moved) notice('info', `Moved ${moved} API key${moved > 1 ? 's' : ''} from your .env file into the app. You can delete them from the .env file now.`)
      writeFileSync(migratedMark, 'done\n')
    } catch { /* will try again next launch */ }
  }
  const getKey = (p: CloudProvider): string | null => secrets.get(p)
  const coach = new EnglishCoach({ settings: () => settings, getKey: () => getKey('openai'), usage: () => usageStore })
  // Speech on this computer needs nothing installed: Whisper inside the app (model bundled in resources/models when present, else downloaded once) and the system voice
  const bundledModels = join(process.resourcesPath ?? '', 'models')
  // ONNX Runtime ships no binary for Intel Macs, so the built-in speech recognition is only offered where it can run
  const nativeStt = process.platform === 'darwin' && process.arch === 'x64' ? undefined : new NativeStt(app.isPackaged && existsSync(bundledModels) ? bundledModels : join(app.getPath('userData'), 'models'))
  const systemTts = new SystemTts()
  const router = new SpeechRouter({ settings: () => settings, getKey, local: { tts, nativeStt, systemTts }, usage: () => usageStore, onError: (m) => notice('warn', m) })
  const voice = new VoiceCoordinator({
    ttsEnabled: (voiceId) => router.ttsUsable(voiceId),
    voiceKey: (voiceId) => router.voiceKey(voiceId),
    getSession: (id) => sessions.getRecord(id),
    isMuted: (id) => sessions.isMuted(id),
    settings: () => settings,
    focus: () => ({ selectedSessionId: sessions.selected, windowFocused: !!win && win.isFocused() && !win.isMinimized() }),
    synthesize: (t, v, s) => router.synthesize(t, v, s),
    deliver: (c) => {
      const copy = c.audio.buffer.slice(c.audio.byteOffset, c.audio.byteOffset + c.audio.byteLength)
      send('audio:chunk', { requestId: c.requestId, eventId: c.eventId, sessionId: c.sessionId, index: c.index, total: c.total, speed: c.speed, data: copy })
    },
    finish: (requestId) => new Promise<void>((resolve) => {
      if (endedEarly.delete(requestId)) { resolve(); return }
      const done = () => { pendingAudio.delete(requestId); clearTimeout(timer); resolve() }
      const timer = setTimeout(done, 15 * 60_000) // the renderer never answered: don't wedge the queue forever
      pendingAudio.set(requestId, done)
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
    // Anything sent to an agent (typed in the terminal or from the composer) gets its natural version shown under it in Activity, no approval step.
    if (e.type === 'USER_PROMPT_SUBMITTED') void coachPrompt(e.sessionId, e.id, e.payload.prompt)
    if (e.type !== 'ASSISTANT_MESSAGE_DELTA') send('activity:event', e)
    voice.onEvent(e)
    void eventStore?.record(e).catch(() => undefined)
  })

  async function coachPrompt(sessionId: string, eventId: string, prompt: string): Promise<void> {
    const rec = sessions.getRecord(sessionId)
    if (!rec || !coachOnFor(settings.englishCoach, rec.englishCoach) || !coach.available() || !shouldCoach(prompt)) return
    try {
      const natural = await coach.improve(prompt)
      if (!natural) return
      send('coach:natural', { sessionId, eventId, natural })
      void coachHistory.record({ sessionId, eventId, original: prompt.trim(), natural }).catch(() => undefined)
    } catch { /* the coach is a nicety: never surface its failures next to the user's work */ }
  }

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
  ipcMain.handle('sessions:claudeProfiles', () => claudeProfiles())
  ipcMain.handle('sessions:start', async (_e, p) => { const a = parse(schemas.start, p); await sessions.start(requireSession(a.id), a.cols, a.rows) })
  ipcMain.handle('sessions:stop', async (_e, p) => { const a = parse(schemas.id, p); voice.queue.cancelSession(a.id); await sessions.stop(requireSession(a.id)) })
  ipcMain.handle('sessions:rename', (_e, p) => { const a = parse(schemas.rename, p); return sessions.rename(requireSession(a.id), a.title) })
  ipcMain.handle('sessions:delete', async (_e, p) => { const a = parse(schemas.id, p); voice.queue.cancelSession(a.id); await sessions.delete(requireSession(a.id)); voice.focusChanged() })
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
    return router.transcribe(new Uint8Array(wav)) // audio lives in memory only; nothing is written to disk (a cloud provider receives it for the call)
  })
  ipcMain.handle('voice:send', (_e, p) => {
    const a = parse(schemas.send, p)
    return sessions.sendText(requireSession(a.id), a.text, { auto: a.auto, force: a.force })
  })
  ipcMain.handle('voice:stop', () => { voice.queue.cancelAll() })
  ipcMain.handle('voice:listen', (_e, p) => { const a = parse(schemas.listen, p); return voice.listen(requireSession(a.id), a.text, a.ref) })
  ipcMain.handle('voice:preview', (_e, p) => { voice.preview(parse(schemas.voicePreview, p).voiceId, 'Hello, this is how I sound when I give you an update.') })
  ipcMain.handle('audio:ended', (_e, p) => {
    const id = parse(schemas.audioEnded, p).requestId
    const done = pendingAudio.get(id)
    if (done) done(); else { endedEarly.add(id); if (endedEarly.size > 100) endedEarly.delete(endedEarly.values().next().value as string) }
  })

  ipcMain.handle('voices:list', async () => {
    // The built-in voice always exists; clones only exist on a Chatterbox server
    const base = [{ id: 'default', name: settings.ttsEngine === 'chatterbox' ? 'Chatterbox default' : 'System voice' }]
    if (settings.ttsEngine !== 'chatterbox') return base
    try { return await tts.listVoices() } catch { return base }
  })
  const needChatterbox = () => { if (settings.ttsEngine !== 'chatterbox') throw new Error('Voice cloning needs the Chatterbox engine (Settings → Voice).') }
  ipcMain.handle('voices:create', async (_e, p: { name: string; wav: ArrayBuffer }) => {
    needChatterbox()
    const { name } = parse(schemas.voiceCreate, { name: p.name })
    return tts.createVoice(name, new Uint8Array(p.wav))
  })
  ipcMain.handle('voices:delete', async (_e, p) => {
    needChatterbox()
    await tts.deleteVoice(parse(schemas.voiceDelete, p).voiceId)
  })

  ipcMain.handle('settings:get', () => settings)
  ipcMain.handle('settings:save', async (_e, p) => {
    const patch = parse(schemas.settingsPatch, p)
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS) || typeof v !== typeof (DEFAULT_SETTINGS as never)[k]) continue
      if (k === 'externalTerminal' && !['auto', 'ptyxis', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'x-terminal-emulator'].includes(v as string)) continue
      if (k === 'sttProvider' && !SPEECH_PROVIDERS.includes(v as never)) continue
      if (k === 'ttsEngine' && !TTS_ENGINES.includes(v as never)) continue
      if (k === 'ttsUrl' && !/^https?:\/\/[^\s]+$/.test(v as string)) continue
      if (typeof v === 'string' && v.length > 300) continue
      clean[k] = v
    }
    settings = { ...settings, ...clean } as AppSettings
    await settingsStore?.save(clean as Partial<AppSettings>).catch(() => notice('warn', 'Could not save settings.'))
    send('settings:changed', settings)
    voice.focusChanged()
    return settings
  })

  ipcMain.handle('status:get', async (): Promise<ServiceStatus & { keys: { openai: boolean; gemini: boolean }; keysPersist: boolean; agents: Record<string, { installed: boolean; version?: string }>; capabilities: unknown }> => {
    const [sp, claude, codex, kiro] = await Promise.all([router.status(), new ClaudeCodeAdapter(repoRoot).detect(), new CodexAdapter().detect(), new KiroAdapter().detect()])
    return { ...sp, db: !!localDb, keys: { openai: router.hasKey('openai'), gemini: router.hasKey('gemini') }, keysPersist: secrets.persistent(), agents: { claude, codex, kiro },
      capabilities: { claude: new ClaudeCodeAdapter(repoRoot).capabilities, codex: new CodexAdapter().capabilities, kiro: new KiroAdapter().capabilities } }
  })
  ipcMain.handle('secrets:set', (_e, p) => {
    const a = parse(schemas.secretSet, p)
    const persisted = secrets.set(a.provider as SecretName, a.key)
    if (!persisted) notice('warn', 'This computer has no secure key storage, so the key is kept only until you quit the app.')
    return { persisted }
  })
  ipcMain.handle('secrets:remove', (_e, p) => { secrets.remove(parse(schemas.cloudProvider, p).provider as SecretName) })
  ipcMain.handle('engine:testChatterbox', async (_e, p) => {
    const url = parse(schemas.chatterboxTest, p).url
    const st = await new TtsClient(() => url).status()
    return st
  })
  ipcMain.handle('cloud:models', (_e, p) => { const a = parse(schemas.cloudProvider, p); return listModels(router.cloudConfig(), a.provider) })
  ipcMain.handle('cloud:test', (_e, p) => {
    const a = parse(schemas.cloudTest, p)
    return selfTest(router, a.provider, { ttsModel: a.ttsModel, sttModel: a.sttModel, style: a.style }, a.voice ?? (a.provider === 'openai' ? 'coral' : 'Kore'), (wav) => {
      const data = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength)
      send('audio:chunk', { requestId: `test-${Date.now()}`, eventId: 'test', sessionId: 'test', index: 0, total: 1, speed: 1, data })
    })
  })
  ipcMain.handle('coach:improve', (_e, p) => coach.improve(parse(schemas.coachImprove, p).text))
  // "Open in system terminal": stop uTerm's copy first (two processes must never share one conversation), then open the user's terminal app
  ipcMain.handle('sessions:popOut', async (_e, p) => {
    const a = parse(schemas.id, p); requireSession(a.id)
    if (sessions.isRunning(a.id)) await sessions.stop(a.id)
    const rec = sessions.getRecord(a.id)!
    const cwd = rec.agentType === 'shell' && rec.lastCwd && existsSync(rec.lastCwd) ? rec.lastCwd : rec.workingDirectory
    if (!existsSync(cwd)) throw new Error(`The folder no longer exists: ${cwd}`)
    return popOut({ preferred: settings.externalTerminal, cwd, shell: userShell(), input: { agent: rec.agentType, nativeSessionId: rec.nativeSessionId, configDir: rec.configDir } })
  })
  // plain terminals: remember where the shell is (every few seconds), and the commands the user chose to keep
  setInterval(() => { void sessions.refreshAllCwds() }, 4000).unref()
  ipcMain.handle('commands:list', (_e, p) => commandStore.list(requireSession(parse(schemas.sessionIdOnly, p).sessionId)))
  ipcMain.handle('commands:add', (_e, p) => { const a = parse(schemas.commandAdd, p); return commandStore.add(requireSession(a.sessionId), a.command.trim(), a.label?.trim() || null) })
  ipcMain.handle('commands:remove', (_e, p) => commandStore.remove(parse(schemas.id, p).id))
  ipcMain.handle('commands:run', async (_e, p) => {
    const a = parse(schemas.commandRun, p)
    const c = await commandStore.get(a.id)
    return c ? sessions.runCommand(c.sessionId, c.command, a.run) : false
  })
  if (settings.sttProvider === 'local') nativeStt?.warm() // load the built-in model in the background
  const sampler = new SystemSampler()
  ipcMain.handle('system:sample', (_e, p) => { const a = parse(schemas.systemSample, p ?? {}); return sampler.sample(a.sessionId ? pty.pidOf(a.sessionId) : null) })
  ipcMain.handle('usage:summary', () => usageStore.summary())
  // Links clicked in a terminal: only web addresses are handed to the system browser (never file:, javascript: or custom schemes).
  ipcMain.handle('app:openUrl', async (_e, p) => {
    const u = new URL(parse(schemas.openUrl, p).url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web links can be opened')
    await shell.openExternal(u.toString())
  })
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('clipboard:write', (_e, p) => { clipboard.writeText(parse(schemas.text, p).text) })

  // Tabs to bring back on the next launch: remembered while the app runs (so a crash keeps them) and once more right before quitting.
  const tabsFile = join(app.getPath('userData'), 'open-tabs.json')
  const restoreIds = readOpenTabs(tabsFile) // what the previous run left open
  const runningIds = () => sessions.runningIds()
  let lastSaved = ''
  const saveTabs = () => { if (quitting) return; const ids = runningIds(); const j = JSON.stringify(ids); if (j !== lastSaved) { lastSaved = j; writeOpenTabs(tabsFile, ids) } }
  setInterval(saveTabs, 3000).unref()
  ipcMain.handle('app:restoreTabs', () => restoreIds.filter((id) => { try { return !!sessions.getRecord(id) } catch { return false } }))

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
    writeOpenTabs(tabsFile, runningIds()) // what was open right now
    quitting = true
    await sessions.stopAll()
    localDb?.close()
    await hookServer.stop()
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
    width: 1440, height: 900, minWidth: 900, minHeight: 560, backgroundColor: '#1e1e1e', title: 'uTerm', icon: appIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required' // notification sounds must play without a click
    }
  })
  win.webContents.on('did-finish-load', () => { for (const n of pendingNotices.splice(0)) send('notice', n) })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
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
