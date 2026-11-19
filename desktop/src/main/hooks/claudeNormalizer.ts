import type { EventDraft } from '@shared/events'
import { HookPayload } from './schemas'
import { MessageAggregator } from '../events/messageAggregator'
import { TurnTracker } from '../events/turnTracker'

/**
 * Per-session stateful translator from Claude Code hook payloads to
 * normalised events. State: message reassembly + progress/final classification.
 */
export class ClaudeNormalizer {
  private aggregator = new MessageAggregator()
  private tracker = new TurnTracker()
  private turnId: string | null = null

  /** Returns [] for unknown/invalid payloads (hooks must never break the app). */
  normalize(raw: unknown, now = Date.now()): EventDraft[] {
    const parsed = HookPayload.safeParse(raw)
    if (!parsed.success) return []
    const p = parsed.data
    const nativeSessionId = p.session_id ?? null
    if (p.turn_id) this.turnId = p.turn_id
    const common = { nativeSessionId, turnId: this.turnId, timestamp: now }
    const out: EventDraft[] = []

    switch (p.hook_event_name) {
      case 'SessionStart':
        out.push({ ...common, type: 'SESSION_STARTED', payload: { source: p.source, transcriptPath: p.transcript_path } })
        break
      case 'SessionEnd':
        out.push({ ...common, type: 'SESSION_ENDED', payload: { reason: p.reason } })
        break
      case 'UserPromptSubmit':
        this.tracker.reset()
        out.push({ ...common, type: 'USER_PROMPT_SUBMITTED', payload: { prompt: p.prompt ?? '' } })
        break
      case 'MessageDisplay': {
        if (p.delta) {
          out.push({ ...common, type: 'ASSISTANT_MESSAGE_DELTA', payload: { messageId: p.message_id, index: p.index, text: p.delta } })
        }
        const text = this.aggregator.ingest({ messageId: p.message_id, index: p.index, final: p.final, delta: p.delta }, now)
        if (text !== null && text.trim()) {
          out.push({ ...common, type: 'ASSISTANT_MESSAGE_COMPLETED', payload: { messageId: p.message_id, text } })
          const promoted = this.tracker.onMessage({ messageId: p.message_id, text }, now)
          if (promoted) out.push({ ...common, type: 'AGENT_PROGRESS', payload: { messageId: promoted.messageId, text: promoted.text } })
        }
        break
      }
      case 'PreToolUse': {
        const promoted = this.tracker.onToolActivity()
        if (promoted) out.push({ ...common, type: 'AGENT_PROGRESS', payload: { messageId: promoted.messageId, text: promoted.text } })
        if (p.tool_name === 'AskUserQuestion') {
          for (const q of extractQuestions(p.tool_input)) out.push({ ...common, type: 'QUESTION_REQUESTED', payload: { question: q } })
        } else {
          out.push({ ...common, type: 'TOOL_STARTED', payload: { tool: p.tool_name, summary: summarizeTool(p.tool_name, p.tool_input) } })
        }
        break
      }
      case 'PostToolUse':
        out.push({ ...common, type: 'TOOL_COMPLETED', payload: { tool: p.tool_name, ok: true } })
        break
      case 'PostToolUseFailure':
        out.push({ ...common, type: 'TOOL_COMPLETED', payload: { tool: p.tool_name, ok: false } })
        break
      case 'PermissionRequest':
        out.push({ ...common, type: 'PERMISSION_REQUESTED', payload: { tool: p.tool_name, summary: summarizeTool(p.tool_name, p.tool_input) } })
        break
      case 'Notification':
        // Permission/question prompts have dedicated events; idle notifications are visual-only.
        out.push({ ...common, type: 'ATTENTION_REQUIRED', payload: { reason: p.notification_type ?? 'notification', message: p.message ?? '' } })
        break
      case 'Stop': {
        const { final } = this.tracker.onTurnEnd(p.last_assistant_message ?? null)
        out.push({ ...common, type: 'TURN_COMPLETED', payload: { messageId: final?.messageId ?? null, text: final?.text ?? null } })
        break
      }
      case 'StopFailure':
        this.tracker.reset()
        out.push({ ...common, type: 'AGENT_ERROR', payload: { message: failureMessage(p), blocker: true } })
        break
    }
    return out
  }

  /** Periodic housekeeping: stale candidates become progress. */
  tick(now = Date.now()): EventDraft[] {
    const p = this.tracker.tick(now)
    return p ? [{ type: 'AGENT_PROGRESS', payload: { messageId: p.messageId, text: p.text }, timestamp: now }] : []
  }

  flushStale(now = Date.now()): EventDraft[] {
    return this.aggregator.flushStale(3000, now).flatMap(({ messageId, text }) =>
      text.trim() ? [{ type: 'ASSISTANT_MESSAGE_COMPLETED' as const, payload: { messageId, text }, timestamp: now }] : [])
  }
}

function extractQuestions(input: Record<string, unknown> | undefined): string[] {
  const qs = (input as { questions?: unknown } | undefined)?.questions
  if (!Array.isArray(qs)) return []
  return qs.map((q) => (q && typeof (q as { question?: unknown }).question === 'string' ? (q as { question: string }).question : ''))
    .filter(Boolean)
}

/** Short, display-only description. Not spoken, not executed. */
export function summarizeTool(tool: string, input: Record<string, unknown> | undefined): string {
  const get = (k: string) => (typeof input?.[k] === 'string' ? (input[k] as string) : '')
  const s = get('command') || get('file_path') || get('path') || get('pattern') || get('url') || get('description')
  return s.length > 160 ? s.slice(0, 157) + '…' : s
}

function failureMessage(p: { error?: unknown; error_type?: string; message?: string }): string {
  if (p.message) return p.message
  const t = p.error_type ?? (typeof p.error === 'string' ? p.error : '')
  return t ? `I hit an error and stopped: ${t.replace(/_/g, ' ')}.` : 'I hit an error and stopped.'
}
