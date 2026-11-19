import type { AnyAgentEvent } from '@shared/events'
import type { RuntimeState } from '@shared/types'

/** Pure runtime-state transition. Runtime state is never persisted. */
export function nextState(current: RuntimeState, e: AnyAgentEvent): RuntimeState {
  if (current === 'CLOSED') return current
  switch (e.type) {
    case 'SESSION_STARTED': return current === 'STARTING' ? 'IDLE' : current
    case 'USER_PROMPT_SUBMITTED':
    case 'AGENT_PROGRESS':
    case 'ASSISTANT_MESSAGE_DELTA':
    case 'ASSISTANT_MESSAGE_COMPLETED':
    case 'TOOL_STARTED':
    case 'TOOL_COMPLETED':
      return current === 'WAITING_FOR_INPUT' && e.type !== 'USER_PROMPT_SUBMITTED' && e.type !== 'TOOL_COMPLETED' ? current : 'WORKING'
    case 'QUESTION_REQUESTED': return 'WAITING_FOR_INPUT'
    case 'PERMISSION_REQUESTED': return 'WAITING_FOR_PERMISSION'
    case 'AGENT_ERROR': return 'ERROR'
    case 'TURN_COMPLETED': return 'IDLE'
    default: return current
  }
}

export const needsAttention = (e: AnyAgentEvent): boolean =>
  e.type === 'QUESTION_REQUESTED' || e.type === 'PERMISSION_REQUESTED' ||
  (e.type === 'AGENT_ERROR' && e.payload.blocker) || e.type === 'TURN_COMPLETED'
