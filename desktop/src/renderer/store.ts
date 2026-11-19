import { reactive } from 'vue'
import type { AnyAgentEvent } from '@shared/events'
import { DEFAULT_SETTINGS, type AppSettings, type ServiceStatus, type SessionView, type VoiceProfile } from '@shared/types'

export interface ActivityItem {
  id: string; at: number; kind: 'prompt' | 'progress' | 'tool' | 'question' | 'permission' | 'error' | 'final' | 'attention'
  text: string
}
export interface Notice { id: number; level: 'info' | 'warn' | 'error'; message: string }
export interface AgentInfo { installed: boolean; version?: string }

export const store = reactive({
  sessions: [] as SessionView[],
  selectedId: null as string | null,
  activity: {} as Record<string, ActivityItem[]>,
  currentOp: {} as Record<string, string>,
  settings: { ...DEFAULT_SETTINGS } as AppSettings,
  status: { stt: false, tts: false, ttsReady: false, db: false } as ServiceStatus,
  agents: {} as Record<string, AgentInfo>,
  capabilities: {} as Record<string, { notes: string[] }>,
  voices: [{ id: 'default', name: 'Default' }] as VoiceProfile[],
  audio: { speakingSessionId: null as string | null, queued: 0 },
  notices: [] as Notice[],
  confirmQuit: false,
  showActivity: true
})

let noticeId = 0
export function notify(level: Notice['level'], message: string, ttl = level === 'info' ? 8000 : 30000): void {
  const n = { id: ++noticeId, level, message }
  store.notices.push(n)
  setTimeout(() => { store.notices = store.notices.filter((x) => x.id !== n.id) }, ttl)
}

export const selected = (): SessionView | undefined => store.sessions.find((s) => s.id === store.selectedId)

export function upsertSession(v: SessionView): void {
  const i = store.sessions.findIndex((s) => s.id === v.id)
  if (i >= 0) store.sessions[i] = v
  else store.sessions.unshift(v)
}

function toActivity(e: AnyAgentEvent): ActivityItem | null {
  const base = { id: e.id, at: e.timestamp }
  switch (e.type) {
    case 'USER_PROMPT_SUBMITTED': return { ...base, kind: 'prompt', text: e.payload.prompt }
    case 'AGENT_PROGRESS': return { ...base, kind: 'progress', text: e.payload.text }
    case 'QUESTION_REQUESTED': return { ...base, kind: 'question', text: e.payload.question }
    case 'PERMISSION_REQUESTED': return { ...base, kind: 'permission', text: `${e.payload.tool}${e.payload.summary ? ': ' + e.payload.summary : ''}` }
    case 'AGENT_ERROR': return { ...base, kind: 'error', text: e.payload.message }
    case 'TURN_COMPLETED': return e.payload.text ? { ...base, kind: 'final', text: e.payload.text } : null
    case 'ATTENTION_REQUIRED': return e.payload.message ? { ...base, kind: 'attention', text: e.payload.message } : null
    default: return null
  }
}

export function ingestEvent(e: AnyAgentEvent): void {
  if (e.type === 'TOOL_STARTED') store.currentOp[e.sessionId] = `${e.payload.tool}${e.payload.summary ? ' · ' + e.payload.summary : ''}`
  if (e.type === 'TOOL_COMPLETED' || e.type === 'TURN_COMPLETED' || e.type === 'USER_PROMPT_SUBMITTED') store.currentOp[e.sessionId] = ''
  const item = toActivity(e)
  if (!item) return
  const list = (store.activity[e.sessionId] ??= [])
  if (list.some((x) => x.id === item.id)) return
  list.push(item)
  if (list.length > 300) list.splice(0, list.length - 300)
}

export function ingestHistory(sessionId: string, rows: Array<{ type: string; payload: Record<string, unknown>; at: number }>): void {
  if ((store.activity[sessionId]?.length ?? 0) > 0) return
  const fake = rows.map((r, i) => toActivity({ id: `h${i}-${r.at}`, sessionId, nativeSessionId: null, agent: 'claude', type: r.type, timestamp: r.at, turnId: null, payload: r.payload } as AnyAgentEvent)).filter(Boolean) as ActivityItem[]
  store.activity[sessionId] = fake
}
