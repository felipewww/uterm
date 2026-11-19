import { z } from 'zod'

// Envelope written by the hook scripts (hooks/claude, hooks/codex) onto the Unix socket.
export const HookEnvelope = z.object({
  v: z.literal(1),
  agent: z.enum(['claude', 'codex']),
  /** ECHO_TERM_SESSION_ID of the PTY the agent runs in. Absent => unmanaged agent, ignored. */
  sessionKey: z.string().uuid(),
  seq: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown())
})
export type HookEnvelope = z.infer<typeof HookEnvelope>

const base = z.object({
  session_id: z.string().optional(),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  prompt_id: z.string().optional(),
  turn_id: z.string().optional()
})

export const HookPayload = z.discriminatedUnion('hook_event_name', [
  base.extend({ hook_event_name: z.literal('SessionStart'), source: z.string().optional() }),
  base.extend({ hook_event_name: z.literal('SessionEnd'), reason: z.string().optional() }),
  base.extend({ hook_event_name: z.literal('UserPromptSubmit'), prompt: z.string().optional() }),
  base.extend({
    hook_event_name: z.literal('MessageDisplay'),
    message_id: z.string(), index: z.number().int().nonnegative(), final: z.boolean(), delta: z.string()
  }),
  base.extend({
    hook_event_name: z.literal('PreToolUse'),
    tool_name: z.string(), tool_input: z.record(z.string(), z.unknown()).optional(), tool_use_id: z.string().optional()
  }),
  base.extend({
    hook_event_name: z.literal('PostToolUse'),
    tool_name: z.string(), tool_use_id: z.string().optional()
  }),
  base.extend({
    hook_event_name: z.literal('PostToolUseFailure'),
    tool_name: z.string(), tool_use_id: z.string().optional(), error: z.unknown().optional()
  }),
  base.extend({
    hook_event_name: z.literal('PermissionRequest'),
    tool_name: z.string(), tool_input: z.record(z.string(), z.unknown()).optional()
  }),
  base.extend({
    hook_event_name: z.literal('Notification'),
    message: z.string().optional(), notification_type: z.string().optional()
  }),
  base.extend({ hook_event_name: z.literal('Stop'), last_assistant_message: z.string().nullish() }),
  base.extend({ hook_event_name: z.literal('StopFailure'), error: z.unknown().optional(), error_type: z.string().optional(), message: z.string().optional() })
])
export type HookPayload = z.infer<typeof HookPayload>

export const MAX_HOOK_BYTES = 1_000_000
