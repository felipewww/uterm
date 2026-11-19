import { reactive, watch } from 'vue'
import type { AnyAgentEvent } from '@shared/events'
import { extractVoiceSummary, stripSpeechTags, stripVoiceTags } from '@shared/voiceTag'
import { DEFAULT_SETTINGS, type AppSettings, type AudioState, type FolderRecord, type ServiceStatus, type SessionView, type VoiceProfile } from '@shared/types'

export interface ActivityItem {
  id: string; at: number; kind: 'prompt' | 'progress' | 'tool' | 'question' | 'permission' | 'error' | 'final' | 'attention'
  text: string
  /** What "Listen" reads when it differs from `text` (the summary with its expressive tags). */
  speech?: string
  /** Agent messages that carry a <voice> summary: `text` is the summary, `full` the whole response. */
  full?: string
  /** the app spoke this message aloud */
  spoken?: boolean
}
export interface Notice { id: number; level: 'info' | 'warn' | 'error'; message: string }
export interface AgentInfo { installed: boolean; version?: string; path?: string }

export const store = reactive({
  sessions: [] as SessionView[],
  folders: [] as FolderRecord[],
  selectedId: null as string | null,
  activity: {} as Record<string, ActivityItem[]>,
  currentOp: {} as Record<string, string>,
  settings: { ...DEFAULT_SETTINGS } as AppSettings,
  status: { stt: false, tts: false, ttsReady: false, db: false } as ServiceStatus,
  agents: {} as Record<string, AgentInfo>,
  capabilities: {} as Record<string, { notes: string[] }>,
  voices: [{ id: 'default', name: 'Default' }] as VoiceProfile[],
  audio: { speakingSessionId: null, speakingEventId: null, queued: 0, phase: 'idle', since: 0, queuedEventIds: [] } as AudioState,
  notices: [] as Notice[],
  confirmQuit: false,
  /** session waiting for the user to confirm its deletion */
  confirmDelete: null as SessionView | null,
  showActivity: true
})

// Panel sizes, remembered per machine.
export const PANEL_LIMITS = { sidebar: { min: 200, max: 520, def: 290 }, activity: { min: 260, max: 680, def: 340 } } as const
const LAYOUT_KEY = 'echo-term.layout.v2'
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
export const layout = reactive({ sidebarW: PANEL_LIMITS.sidebar.def as number, activityW: PANEL_LIMITS.activity.def as number })
try {
  const r = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Partial<typeof layout>
  if (typeof r.sidebarW === 'number') layout.sidebarW = clamp(r.sidebarW, PANEL_LIMITS.sidebar.min, PANEL_LIMITS.sidebar.max)
  if (typeof r.activityW === 'number') layout.activityW = clamp(r.activityW, PANEL_LIMITS.activity.min, PANEL_LIMITS.activity.max)
} catch { /* storage unavailable: defaults */ }
watch(layout, (l) => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)) } catch { /* ignore */ } }, { deep: true })
export const resizeSidebar = (d: number): void => { layout.sidebarW = clamp(layout.sidebarW + d, PANEL_LIMITS.sidebar.min, PANEL_LIMITS.sidebar.max) }
export const resizeActivity = (d: number): void => { layout.activityW = clamp(layout.activityW - d, PANEL_LIMITS.activity.min, PANEL_LIMITS.activity.max) } // handle sits left of the panel
export const resetSidebar = (): void => { layout.sidebarW = PANEL_LIMITS.sidebar.def }
export const resetActivity = (): void => { layout.activityW = PANEL_LIMITS.activity.def }

/** Ticks once a second while a voice is being generated, so "Generating… 7s" counts up. */
export const clock = reactive({ now: Date.now() })
setInterval(() => { if (store.audio.phase === 'generating') clock.now = Date.now() }, 1000)
export const generatingFor = (): number => Math.max(0, Math.round((Math.max(clock.now, Date.now() - 999) - store.audio.since) / 1000))

let noticeId = 0
export function notify(level: Notice['level'], message: string, ttl = level === 'info' ? 8000 : 30000): void {
  const n = { id: ++noticeId, level, message }
  store.notices.push(n)
  setTimeout(() => { store.notices = store.notices.filter((x) => x.id !== n.id) }, ttl)
}

/** The session is gone for good: forget everything the UI holds about it. */
export function removeSession(id: string): void {
  store.sessions = store.sessions.filter((s) => s.id !== id)
  delete store.activity[id]; delete store.currentOp[id]
  if (store.selectedId === id) store.selectedId = null
  if (store.confirmDelete?.id === id) store.confirmDelete = null
}

export const selected = (): SessionView | undefined => store.sessions.find((s) => s.id === store.selectedId)

export function upsertSession(v: SessionView): void {
  const i = store.sessions.findIndex((s) => s.id === v.id)
  if (i >= 0) store.sessions[i] = v
  else store.sessions.unshift(v)
}

/** Show the spoken summary when the agent wrote one; the full response stays one click away (and in the terminal). */
function agentMessage(base: { id: string; at: number }, kind: 'progress' | 'final', raw: string): ActivityItem {
  const summary = extractVoiceSummary(raw)
  const rest = stripSpeechTags(stripVoiceTags(raw))
  if (summary) {
    const shown = stripSpeechTags(summary)
    const item: ActivityItem = { ...base, kind, text: shown }
    if (shown !== summary) item.speech = summary // keep the tags for replays
    if (rest) item.full = rest
    return item
  }
  return { ...base, kind, text: rest || raw }
}

function toActivity(e: AnyAgentEvent): ActivityItem | null {
  const base = { id: e.id, at: e.timestamp }
  switch (e.type) {
    case 'USER_PROMPT_SUBMITTED': return { ...base, kind: 'prompt', text: e.payload.prompt }
    case 'AGENT_PROGRESS': return agentMessage(base, 'progress', e.payload.text)
    case 'QUESTION_REQUESTED': return { ...base, kind: 'question', text: e.payload.question }
    case 'PERMISSION_REQUESTED': return { ...base, kind: 'permission', text: `${e.payload.tool}${e.payload.summary ? ': ' + e.payload.summary : ''}` }
    case 'AGENT_ERROR': return { ...base, kind: 'error', text: e.payload.message }
    case 'TURN_COMPLETED': return e.payload.text ? agentMessage(base, 'final', e.payload.text) : null
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

export function ingestHistory(sessionId: string, rows: Array<{ id?: string; type: string; payload: Record<string, unknown>; at: number; spoken?: boolean }>): void {
  if ((store.activity[sessionId]?.length ?? 0) > 0) return
  const items = rows.map((r, i) => {
    const item = toActivity({ id: r.id ?? `h${i}-${r.at}`, sessionId, nativeSessionId: null, agent: 'claude', type: r.type, timestamp: r.at, turnId: null, payload: r.payload } as AnyAgentEvent)
    if (item && r.spoken) item.spoken = true
    return item
  }).filter(Boolean) as ActivityItem[]
  store.activity[sessionId] = items
}

/** The app just spoke this event aloud: mark its activity item. */
export function markSpoken(sessionId: string, eventId: string): void {
  const item = store.activity[sessionId]?.find((x) => x.id === eventId)
  if (item) item.spoken = true
}
