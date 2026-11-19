import type { EventDraft } from '@shared/events'
import { TurnTracker } from '../events/turnTracker'

/**
 * Read-only interpretation of Codex rollout JSONL lines.
 * Verified against codex-cli 0.154–0.169 transcripts:
 *   response_item/message(role=assistant, phase=commentary|final_answer)
 *   event_msg/task_started, event_msg/task_complete{last_agent_message}
 *   event_msg/item_completed(UserMessage) (older: user_message), event_msg/turn_aborted
 */
export class CodexTranscriptParser {
  private tracker = new TurnTracker()
  private turnId: string | null = null
  private seenMessageIds = new Set<string>()

  parseLine(line: string): EventDraft[] {
    let o: any
    try { o = JSON.parse(line) } catch { return [] }
    if (!o || typeof o !== 'object') return []
    const p = o.payload ?? {}
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) || Date.now() : Date.now()
    const common = { timestamp: ts, turnId: this.turnId }

    if (o.type === 'session_meta' && typeof p.id === 'string') {
      return [{ ...common, type: 'SESSION_STARTED', nativeSessionId: p.id, payload: { source: p.source } }]
    }
    if (o.type === 'event_msg') {
      switch (p.type) {
        case 'task_started':
          this.turnId = typeof p.turn_id === 'string' ? p.turn_id : null
          this.tracker.reset()
          return []
        case 'user_message': // older Codex versions
          return [{ ...common, type: 'USER_PROMPT_SUBMITTED', payload: { prompt: typeof p.message === 'string' ? p.message : '' } }]
        case 'item_completed': { // codex-cli 0.16x: user prompts arrive as UserMessage items
          if (p.item?.type !== 'UserMessage') return []
          const prompt = (Array.isArray(p.item.content) ? p.item.content : [])
            .map((c: any) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('')
          return [{ ...common, type: 'USER_PROMPT_SUBMITTED', payload: { prompt } }]
        }
        case 'task_complete': {
          const { final } = this.tracker.onTurnEnd(typeof p.last_agent_message === 'string' ? p.last_agent_message : null)
          return [{ ...common, type: 'TURN_COMPLETED', payload: { messageId: final?.messageId ?? null, text: final?.text ?? null } }]
        }
        case 'turn_aborted':
          this.tracker.reset()
          return [{ ...common, type: 'TURN_COMPLETED', payload: { messageId: null, text: null } }]
      }
      return []
    }
    if (o.type === 'response_item') {
      if (p.type === 'message' && p.role === 'assistant') {
        const id = typeof p.id === 'string' ? p.id : ''
        if (id && this.seenMessageIds.has(id)) return []
        if (id) this.seenMessageIds.add(id)
        const text = (Array.isArray(p.content) ? p.content : [])
          .map((c: any) => (c && c.type === 'output_text' && typeof c.text === 'string' ? c.text : ''))
          .join('')
        if (!text.trim()) return []
        const out: EventDraft[] = [{ ...common, type: 'ASSISTANT_MESSAGE_COMPLETED', payload: { messageId: id || text.slice(0, 32), text } }]
        // Codex labels the phase explicitly: commentary = progress, final_answer = result.
        if (p.phase === 'commentary') {
          out.push({ ...common, type: 'AGENT_PROGRESS', payload: { messageId: id || text.slice(0, 32), text } })
        } else {
          const promoted = this.tracker.onMessage({ messageId: id || text.slice(0, 32), text })
          if (promoted) out.push({ ...common, type: 'AGENT_PROGRESS', payload: { messageId: promoted.messageId, text: promoted.text } })
        }
        return out
      }
      if (p.type === 'custom_tool_call' || p.type === 'function_call') {
        const name = typeof p.name === 'string' ? p.name : 'tool'
        return [{ ...common, type: 'TOOL_STARTED', payload: { tool: name, summary: '' } }]
      }
      if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
        return [{ ...common, type: 'TOOL_COMPLETED', payload: { tool: '', ok: true } }]
      }
    }
    return []
  }
}
