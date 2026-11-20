import type { AppSettings } from '@shared/types'

/** Which sound, if any, an agent event deserves. Pure, so the rules are testable. */
export type Chime = 'attention' | 'done'

export interface ChimeContext {
  eventType: string
  /** AGENT_ERROR only: the error blocks the agent until you act */
  blocker?: boolean
  sessionId: string
  selectedId: string | null
  windowFocused: boolean
  sessionMuted: boolean
  /** you are recording: never make noise into the microphone */
  recording: boolean
  settings: Pick<AppSettings, 'notifySounds' | 'notifyOnAttention' | 'notifyOnDone' | 'globalMute'>
}

export function chimeFor(c: ChimeContext): Chime | null {
  const s = c.settings
  if (!s.notifySounds || s.globalMute || c.sessionMuted || c.recording) return null
  if (c.sessionId === c.selectedId && c.windowFocused) return null // you are looking at it: the screen is enough
  if (c.eventType === 'QUESTION_REQUESTED' || c.eventType === 'PERMISSION_REQUESTED' || c.eventType === 'ATTENTION_REQUIRED' || (c.eventType === 'AGENT_ERROR' && c.blocker)) {
    return s.notifyOnAttention ? 'attention' : null
  }
  if (c.eventType === 'TURN_COMPLETED') return s.notifyOnDone ? 'done' : null
  return null
}
