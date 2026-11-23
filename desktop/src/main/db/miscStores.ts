import type { AnyAgentEvent } from '@shared/events'
import type { AppSettings, VoiceProfile } from '@shared/types'

export interface SettingsRepo {
  load(): Promise<AppSettings>
  save(patch: Partial<AppSettings>): Promise<void>
  remove(keys: string[]): Promise<void>
}

/** Relevant events only (not deltas/tool noise), compact payloads. */
export const PERSISTED = new Set(['USER_PROMPT_SUBMITTED', 'AGENT_PROGRESS', 'QUESTION_REQUESTED', 'PERMISSION_REQUESTED', 'AGENT_ERROR', 'TURN_COMPLETED'])

export type RecentEvent = { id: string; type: string; payload: unknown; at: number; spoken: boolean; natural?: string }
/** What the app needs from an activity-history store (the local SQLite database). */
export interface EventRepo {
  record(e: AnyAgentEvent): Promise<void>
  recent(sessionId: string, limit?: number): Promise<RecentEvent[]>
  recordSpoken(sessionId: string, eventId: string, voiceId: string | null, priority: number, text: string): Promise<void>
}

export type { VoiceProfile }
