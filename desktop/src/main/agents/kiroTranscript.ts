import type { EventDraft } from '@shared/events'
import { VOICE_SETUP_MARKER } from '../speechInstructions'

/**
 * Read-only interpretation of Kiro CLI session logs (~/.kiro/sessions/cli/<id>.jsonl), verified against kiro-cli 2.34.
 * One JSON object per line, `{version, kind, data}`:
 *   Prompt            user message         content: [{kind:'text', data:'…'}]
 *   AssistantMessage  assistant message    content: [{kind:'thinking'|'text'|'toolUse', data}]
 *   ToolResults       results of the tools content: [{kind:'toolResult', data:{toolUseId, status}}]
 * A turn ends on an AssistantMessage that has no toolUse (observed: every tool call is followed by ToolResults and then
 * another AssistantMessage). Text before a toolUse is narration = progress. "thinking" blocks are never surfaced.
 * Permission prompts are NOT written to this log, so they cannot be detected here (see the adapter notes).
 */
export class KiroTranscriptParser {
  private turnId: string | null = null
  private seenMessageIds = new Set<string>()
  private pendingTools = new Map<string, string>() // toolUseId -> tool name

  parseLine(line: string): EventDraft[] {
    let o: any
    try { o = JSON.parse(line) } catch { return [] }
    if (!o || typeof o !== 'object' || typeof o.kind !== 'string') return []
    const d = o.data ?? {}
    const ts = typeof d.meta?.timestamp === 'number' ? d.meta.timestamp * 1000 : Date.now()

    if (o.kind === 'Prompt') {
      this.turnId = typeof d.message_id === 'string' ? d.message_id : this.turnId
      this.pendingTools.clear()
      const prompt = textOf(d.content)
      if (prompt.startsWith(VOICE_SETUP_MARKER)) return [] // Echo-Term's own priming message: not something the user typed
      return prompt ? [{ type: 'USER_PROMPT_SUBMITTED', timestamp: ts, turnId: this.turnId, payload: { prompt } }] : []
    }

    if (o.kind === 'AssistantMessage') {
      const id = typeof d.message_id === 'string' ? d.message_id : ''
      if (id && this.seenMessageIds.has(id)) return []
      if (id) this.seenMessageIds.add(id)
      const text = textOf(d.content)
      const tools = (Array.isArray(d.content) ? d.content : []).filter((c: any) => c?.kind === 'toolUse' && c.data)
      const common = { timestamp: Date.now(), turnId: this.turnId }
      const messageId = id || text.slice(0, 32)
      const out: EventDraft[] = []
      if (text) out.push({ ...common, type: 'ASSISTANT_MESSAGE_COMPLETED', payload: { messageId, text } })
      if (tools.length > 0) {
        if (text) out.push({ ...common, type: 'AGENT_PROGRESS', payload: { messageId, text } })
        for (const t of tools) {
          const name = typeof t.data.name === 'string' ? t.data.name : 'tool'
          if (typeof t.data.toolUseId === 'string') this.pendingTools.set(t.data.toolUseId, name)
          out.push({ ...common, type: 'TOOL_STARTED', payload: { tool: name, summary: summarizeKiroTool(t.data.input) } })
        }
      } else {
        out.push({ ...common, type: 'TURN_COMPLETED', payload: { messageId: text ? messageId : null, text: text || null } })
      }
      return out
    }

    if (o.kind === 'ToolResults') {
      const out: EventDraft[] = []
      for (const c of Array.isArray(d.content) ? d.content : []) {
        if (c?.kind !== 'toolResult' || !c.data) continue
        const tool = this.pendingTools.get(c.data.toolUseId) ?? ''
        this.pendingTools.delete(c.data.toolUseId)
        out.push({ timestamp: Date.now(), turnId: this.turnId, type: 'TOOL_COMPLETED', payload: { tool, ok: c.data.status === 'success' } })
      }
      return out
    }
    return []
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.filter((c: any) => c?.kind === 'text' && typeof c.data === 'string').map((c: any) => c.data).join('\n\n').trim()
}

/** Short, display-only description of a tool call (never executed, never spoken). */
export function summarizeKiroTool(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const i = input as Record<string, any>
  const pick = i.command ?? i.path ?? i.file_path ?? i.pattern ?? i.query ?? i.url ?? i.operations?.[0]?.path ?? i.operations?.[0]?.pattern ?? ''
  return typeof pick === 'string' ? pick.replace(/\s+/g, ' ').slice(0, 160) : ''
}
