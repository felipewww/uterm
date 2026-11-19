import { randomUUID } from 'node:crypto'
import type { AgentType } from '@shared/types'
import type { AnyAgentEvent, EventDraft } from '@shared/events'

type Listener = (event: AnyAgentEvent) => void

/** Typed, synchronous, in-process bus. A throwing listener never affects others. */
export class EventBus {
  private listeners = new Set<Listener>()

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(
    ctx: { sessionId: string; agent: AgentType; nativeSessionId?: string | null },
    draft: EventDraft
  ): AnyAgentEvent {
    const event = {
      id: randomUUID(),
      sessionId: ctx.sessionId,
      nativeSessionId: draft.nativeSessionId ?? ctx.nativeSessionId ?? null,
      agent: ctx.agent,
      type: draft.type,
      timestamp: draft.timestamp ?? Date.now(),
      turnId: draft.turnId ?? null,
      payload: draft.payload
    } as AnyAgentEvent
    for (const l of [...this.listeners]) {
      try { l(event) } catch (err) { console.error('[event-bus] listener failed:', (err as Error).message) }
    }
    return event
  }
}
