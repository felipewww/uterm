import type { AnyAgentEvent } from '@shared/events'
import type { AppSettings, SessionRecord, SpeechKind, VoiceMode } from '@shared/types'

/** The communication matrix from the product spec. Deterministic, no LLM. */
export const SPEECH_MATRIX: Record<VoiceMode, Record<SpeechKind, boolean>> = {
  silent:         { question: false, permission: false, blocker: false, final: false, progress: false },
  essential:      { question: true,  permission: true,  blocker: true,  final: false, progress: false },
  balanced:       { question: true,  permission: true,  blocker: true,  final: true,  progress: false },
  conversational: { question: true,  permission: true,  blocker: true,  final: true,  progress: true }
}

export const PRIORITY: Record<SpeechKind, 1 | 2 | 3> = {
  question: 1, permission: 1, blocker: 1, final: 2, progress: 3
}

export const modeAllows = (mode: VoiceMode, kind: SpeechKind): boolean => SPEECH_MATRIX[mode][kind]

export interface FocusContext {
  selectedSessionId: string | null
  windowFocused: boolean
}

/** Foreground = the selected session while the window is focused. Everything else is background. */
export function isForeground(sessionId: string, ctx: FocusContext): boolean {
  return ctx.windowFocused && ctx.selectedSessionId === sessionId
}

/** Session-level overrides win over global defaults. */
export function effectiveMode(
  session: Pick<SessionRecord, 'foregroundVoiceMode' | 'backgroundVoiceMode'>,
  settings: Pick<AppSettings, 'defaultForegroundMode' | 'defaultBackgroundMode'>,
  foreground: boolean
): VoiceMode {
  return foreground
    ? (session.foregroundVoiceMode ?? settings.defaultForegroundMode)
    : (session.backgroundVoiceMode ?? settings.defaultBackgroundMode)
}

export interface Classified { kind: SpeechKind; text: string; dedupeKey: string }

function describeTool(tool: string): string {
  if (/^(bash|shell|exec|command)/i.test(tool)) return 'run a command'
  if (/^(edit|write|multiedit|notebookedit|apply_patch|patch)/i.test(tool)) return 'change a file'
  if (/^(webfetch|websearch)/i.test(tool)) return 'access the web'
  return `use the ${tool.replace(/^mcp__/, '').split('__')[0]} tool`
}

/**
 * Maps a normalised event to something speakable (or null).
 * Never speaks tool starts/completions, raw commands, or hidden reasoning.
 */
export function classifyEvent(e: AnyAgentEvent): Classified | null {
  switch (e.type) {
    case 'QUESTION_REQUESTED':
      return { kind: 'question', text: e.payload.question, dedupeKey: `q:${e.sessionId}:${e.payload.question}` }
    case 'PERMISSION_REQUESTED':
      return { kind: 'permission', text: `I need your permission to ${describeTool(e.payload.tool)}.`, dedupeKey: `p:${e.id}` }
    case 'AGENT_ERROR':
      return e.payload.blocker ? { kind: 'blocker', text: e.payload.message, dedupeKey: `b:${e.id}` } : null
    case 'AGENT_PROGRESS':
      return { kind: 'progress', text: e.payload.text, dedupeKey: `m:${e.payload.messageId}` }
    case 'TURN_COMPLETED':
      return e.payload.text
        ? { kind: 'final', text: e.payload.text, dedupeKey: `m:${e.payload.messageId ?? e.id}` }
        : null
    default:
      return null
  }
}
