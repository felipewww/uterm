import type { AgentType } from './types'

export type EventType =
  | 'SESSION_STARTED' | 'SESSION_ENDED' | 'USER_PROMPT_SUBMITTED'
  | 'ASSISTANT_MESSAGE_DELTA' | 'ASSISTANT_MESSAGE_COMPLETED' | 'AGENT_PROGRESS'
  | 'TOOL_STARTED' | 'TOOL_COMPLETED' | 'QUESTION_REQUESTED' | 'PERMISSION_REQUESTED'
  | 'ATTENTION_REQUIRED' | 'AGENT_ERROR' | 'TURN_COMPLETED'

export interface EventPayloads {
  SESSION_STARTED: { source?: string; transcriptPath?: string }
  SESSION_ENDED: { reason?: string }
  USER_PROMPT_SUBMITTED: { prompt: string }
  ASSISTANT_MESSAGE_DELTA: { messageId: string; index: number; text: string }
  ASSISTANT_MESSAGE_COMPLETED: { messageId: string; text: string }
  /** A completed assistant message followed by more work = a progress update. */
  AGENT_PROGRESS: { messageId: string; text: string }
  TOOL_STARTED: { tool: string; summary: string }
  TOOL_COMPLETED: { tool: string; ok: boolean }
  QUESTION_REQUESTED: { question: string }
  PERMISSION_REQUESTED: { tool: string; summary: string }
  ATTENTION_REQUIRED: { reason: string; message: string }
  AGENT_ERROR: { message: string; blocker: boolean }
  TURN_COMPLETED: { messageId: string | null; text: string | null }
}

export interface AgentEvent<T extends EventType = EventType> {
  id: string
  sessionId: string
  nativeSessionId: string | null
  agent: AgentType
  type: T
  timestamp: number
  turnId: string | null
  payload: EventPayloads[T]
}

export type AnyAgentEvent = { [K in EventType]: AgentEvent<K> }[EventType]

/** What an adapter hands to the bus before ids/timestamps are assigned. */
export type EventDraft = {
  [K in EventType]: {
    type: K
    turnId?: string | null
    nativeSessionId?: string | null
    payload: EventPayloads[K]
    timestamp?: number
  }
}[EventType]
