import { contextBridge, ipcRenderer } from 'electron'
import type { AudioState } from '../shared/types'

type Unsub = () => void
const on = <T>(channel: string, cb: (payload: T) => void): Unsub => {
  const h = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}
const call = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload)

// Restricted bridge: only these named operations are reachable from the renderer.
const api = {
  sessions: {
    list: () => call('sessions:list'),
    create: (p: unknown) => call('sessions:create', p),
    start: (p: unknown) => call('sessions:start', p),
    listImportable: () => call('sessions:listImportable'),
    claudeProfiles: () => call('sessions:claudeProfiles'),
    importSession: (p: unknown) => call('sessions:import', p),
    stop: (p: unknown) => call('sessions:stop', p),
    rename: (p: unknown) => call('sessions:rename', p),
    archive: (p: unknown) => call('sessions:archive', p),
    remove: (p: unknown) => call('sessions:delete', p),
    mute: (p: unknown) => call('sessions:mute', p),
    moveToFolder: (p: unknown) => call('sessions:moveToFolder', p),
    update: (p: unknown) => call('sessions:update', p),
    select: (p: unknown) => call('sessions:select', p),
    openInVscode: (p: unknown) => call('sessions:openInVscode', p),
    activity: (p: unknown) => call('sessions:activity', p),
    pickDirectory: () => call('dialog:pickDirectory')
  },
  folders: {
    list: () => call('folders:list'),
    create: (p: unknown) => call('folders:create', p),
    rename: (p: unknown) => call('folders:rename', p),
    move: (p: unknown) => call('folders:move', p),
    remove: (p: unknown) => call('folders:delete', p)
  },
  pty: {
    write: (p: unknown) => call('pty:write', p),
    resize: (p: unknown) => call('pty:resize', p),
    attach: (p: unknown) => call('pty:attach', p)
  },
  voice: {
    transcribe: (wav: ArrayBuffer) => ipcRenderer.invoke('voice:transcribe', wav),
    send: (p: unknown) => call('voice:send', p),
    recording: (p: unknown) => call('voice:recording', p),
    stopPlayback: () => call('voice:stop'),
    listen: (p: unknown) => call('voice:listen', p),
    preview: (p: unknown) => call('voice:preview', p),
    list: () => call('voices:list'),
    create: (name: string, wav: ArrayBuffer) => ipcRenderer.invoke('voices:create', { name, wav }),
    remove: (p: unknown) => call('voices:delete', p),
    audioEnded: (p: unknown) => call('audio:ended', p)
  },
  settings: { get: () => call('settings:get'), save: (p: unknown) => call('settings:save', p) },
  status: { get: () => call('status:get') },
  cloud: { models: (p: unknown) => call('cloud:models', p), test: (p: unknown) => call('cloud:test', p) },
  usage: { summary: () => call('usage:summary') },
  services: { set: (p: unknown) => call('services:set', p) },
  clipboard: { read: () => call('clipboard:read'), write: (p: unknown) => call('clipboard:write', p) },
  events: {
    onPtyData: (cb: (p: { id: string; data: string }) => void) => on('pty:data', cb),
    onPtyExit: (cb: (p: { id: string }) => void) => on('pty:exit', cb),
    onSessionRemoved: (cb: (p: { id: string }) => void) => on('session:removed', cb),
    onFolders: (cb: (p: unknown) => void) => on('folders:changed', cb),
    onSessionView: (cb: (p: unknown) => void) => on('session:view', cb),
    onActivity: (cb: (p: unknown) => void) => on('activity:event', cb),
    onAudioChunk: (cb: (p: { requestId: string; eventId: string; sessionId: string; index: number; total: number; speed: number; data: ArrayBuffer }) => void) => on('audio:chunk', cb),
    onAudioStop: (cb: () => void) => on('audio:stop', cb),
    onAudioState: (cb: (p: AudioState) => void) => on('audio:state', cb),
    onSpoken: (cb: (p: { sessionId: string; eventId: string }) => void) => on('activity:spoken', cb),
    onNotice: (cb: (p: { level: 'info' | 'warn' | 'error'; message: string }) => void) => on('notice', cb),
    onSettings: (cb: (p: unknown) => void) => on('settings:changed', cb),
    onConfirmQuit: (cb: () => void) => on('app:confirm-quit', cb)
  },
  app: { confirmQuit: () => call('app:quit-confirmed') }
}

contextBridge.exposeInMainWorld('echo', api)
export type EchoApi = typeof api
