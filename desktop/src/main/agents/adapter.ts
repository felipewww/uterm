import type { AgentType } from '@shared/types'
import type { EventDraft } from '@shared/events'

export interface AgentCapabilities {
  /** Native session id known before the agent produces any output. */
  preassignedSessionId: boolean
  intermediateMessages: 'hook' | 'transcript' | 'none'
  permissionRequests: 'hook' | 'transcript' | 'none'
  interactiveQuestions: 'hook' | 'none'
  notes: string[]
}

export interface DetectResult { installed: boolean; path?: string; version?: string }

export interface LaunchInput {
  sessionKey: string               // internal session id; exported to the agent as ECHO_TERM_SESSION_ID
  nativeSessionId: string | null   // set => resume
  workingDirectory: string
  socketPath: string
  instructions: string | null      // optional session-scoped speech instructions
}

export interface LaunchSpec { file: string; args: string[]; env: Record<string, string>; newNativeSessionId?: string }

export interface ObserverContext {
  sessionId: string
  workingDirectory: string
  startedAt: number
  resumedNativeId: string | null
  emit(draft: EventDraft): void
  /** Returns false when another running session already owns this native id. */
  claimNativeId(nativeId: string): boolean
  setTranscriptPath(path: string): void
}

/** Per running session: turns native signals (hooks, transcripts) into event drafts. */
export interface AgentObserver {
  onHook(payload: Record<string, unknown>): void
  start(): void
  stop(): void
}

export interface AgentAdapter {
  readonly type: AgentType
  readonly label: string
  readonly capabilities: AgentCapabilities
  detect(): Promise<DetectResult>
  buildLaunch(input: LaunchInput): Promise<LaunchSpec>
  createObserver(ctx: ObserverContext): AgentObserver
}
