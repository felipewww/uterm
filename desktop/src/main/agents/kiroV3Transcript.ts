import type { EventDraft } from '@shared/events'
import { LEGACY_VOICE_SETUP_MARKER, VOICE_SETUP_MARKER } from '../speechInstructions'
import { summarizeKiroTool } from './kiroTranscript'

/**
 * Read-only interpretation of Kiro CLI 3.x session logs (~/.kiro/sessions/<workspace>/<sess_id>/messages.jsonl), verified against
 * kiro-cli 3.5 on macOS. One JSON object per line, `{id, timestamp, payload: {type, …}}`:
 *   user                  the prompt                       content: string
 *   assistant             operationType "Say" = text for the user; "Reasoning"/"Summary" are never surfaced
 *   tool_call / tool_result   toolCallId, toolName, args, title / success, status
 *   pending_interaction   interactionType "tool_approval": Kiro is waiting for you to approve a tool (written to the log in 3.x)
 *   turn_end              stopReason: end_turn | error | cancelled
 * Narration before a tool call is progress; the last "Say" of a turn is its result.
 */
const QUIET_TOOLS = new Set(['update_session_information', 'disclose_context', 'fetch_cloud_config', 'tool_load'])

interface Say { id: string; text: string }

export class KiroV3Parser {
  private turnId: string | null = null
  private seen = new Set<string>() // line ids (assistant messages) and tool call ids already reported
  private tools = new Map<string, { name: string; summary: string }>()
  private last: Say | null = null // the latest Say not yet followed by a tool call

  parseLine(line: string): EventDraft[] {
    let o: any
    try { o = JSON.parse(line) } catch { return [] }
    const p = o?.payload
    if (!p || typeof p !== 'object' || typeof p.type !== 'string') return []
    const ts = Date.parse(o.timestamp) || Date.now()
    const common = () => ({ timestamp: ts, turnId: this.turnId })

    switch (p.type) {
      case 'user': {
        const prompt = typeof p.content === 'string' ? p.content.trim() : ''
        this.turnId = typeof o.id === 'string' ? o.id : this.turnId
        this.tools.clear(); this.last = null
        if (!prompt || prompt.startsWith(VOICE_SETUP_MARKER) || prompt.startsWith(LEGACY_VOICE_SETUP_MARKER)) return [] // uTerm's own priming message
        return [{ type: 'USER_PROMPT_SUBMITTED', ...common(), payload: { prompt } }]
      }
      case 'assistant': {
        if (p.operationType !== 'Say') return [] // reasoning and summaries are never surfaced
        const id = typeof o.id === 'string' ? o.id : ''
        const text = typeof p.content === 'string' ? p.content.trim() : ''
        if (!text || (id && this.seen.has(id))) return []
        if (id) this.seen.add(id)
        this.last = { id: id || text.slice(0, 32), text }
        return [{ type: 'ASSISTANT_MESSAGE_COMPLETED', ...common(), payload: { messageId: this.last.id, text } }]
      }
      case 'tool_call': {
        const id = typeof p.toolCallId === 'string' ? p.toolCallId : ''
        const name = typeof p.toolName === 'string' ? p.toolName : 'tool'
        const summary = (typeof p.title === 'string' && p.title.trim() ? p.title.replace(/\s+/g, ' ').slice(0, 160) : summarizeKiroTool(p.args))
        if (id) this.tools.set(id, { name, summary })
        if ((id && this.seen.has('t:' + id)) || QUIET_TOOLS.has(name)) return []
        if (id) this.seen.add('t:' + id)
        const out: EventDraft[] = []
        if (this.last) { out.push({ type: 'AGENT_PROGRESS', ...common(), payload: { messageId: this.last.id, text: this.last.text } }); this.last = null }
        out.push({ type: 'TOOL_STARTED', ...common(), payload: { tool: name, summary } })
        return out
      }
      case 'tool_result': {
        const id = typeof p.toolCallId === 'string' ? p.toolCallId : ''
        const t = this.tools.get(id)
        if (!t || QUIET_TOOLS.has(t.name) || this.seen.has('r:' + id)) return []
        this.seen.add('r:' + id)
        return [{ type: 'TOOL_COMPLETED', ...common(), payload: { tool: t.name, ok: p.success !== false && p.status !== 'failed' } }]
      }
      case 'pending_interaction': {
        if (p.interactionType !== 'tool_approval') return []
        const t = this.tools.get(String(p.toolCallId))
        return [{ type: 'PERMISSION_REQUESTED', ...common(), payload: { tool: t?.name ?? 'tool', summary: t?.summary ?? '' } }]
      }
      case 'turn_end': {
        const out: EventDraft[] = []
        if (p.stopReason === 'error') out.push({ type: 'AGENT_ERROR', ...common(), payload: { message: 'Kiro stopped because of an error. Check the terminal.', blocker: false } })
        out.push({ type: 'TURN_COMPLETED', ...common(), payload: { messageId: this.last?.id ?? null, text: p.stopReason === 'end_turn' ? (this.last?.text ?? null) : null } })
        this.last = null
        return out
      }
      default: return []
    }
  }
}
