import { z } from 'zod'
import { AGENT_TYPES, VOICE_MODES } from './types'

export const Id = z.string().uuid()
const mode = z.enum(VOICE_MODES as unknown as [string, ...string[]])

export const schemas = {
  create: z.object({
    agentType: z.enum(AGENT_TYPES as unknown as [string, ...string[]]),
    title: z.string().max(160),
    workingDirectory: z.string().min(1).max(1024),
    configDir: z.string().min(1).max(1024).nullable().optional()
  }),
  importSession: z.object({
    agentType: z.enum(AGENT_TYPES as unknown as [string, ...string[]]),
    nativeSessionId: z.string().regex(/^[0-9A-Za-z-]{8,64}$/),
    workingDirectory: z.string().min(1).max(1024),
    title: z.string().max(160),
    configDir: z.string().min(1).max(1024).nullable().optional()
  }),
  start: z.object({ id: Id, cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(500) }),
  id: z.object({ id: Id }),
  listen: z.object({ id: Id, text: z.string().min(1).max(8000), ref: z.string().min(1).max(64) }),
  rename: z.object({ id: Id, title: z.string().min(1).max(160) }),
  archive: z.object({ id: Id, archived: z.boolean() }),
  folderCreate: z.object({ name: z.string().min(1).max(80), parentId: Id.nullable().optional() }),
  folderMove: z.object({ id: Id, parentId: Id.nullable() }),
  folderRename: z.object({ id: Id, name: z.string().min(1).max(80) }),
  moveToFolder: z.object({ id: Id, folderId: Id.nullable() }),
  mute: z.object({ id: Id, muted: z.boolean() }),
  sessionSettings: z.object({
    id: Id,
    patch: z.object({
      voiceProfileId: z.string().max(36).nullable().optional(),
      playbackSpeed: z.number().min(0.5).max(2).nullable().optional(),
      foregroundVoiceMode: mode.nullable().optional(),
      backgroundVoiceMode: mode.nullable().optional(),
      englishCoach: z.boolean().nullable().optional()
    })
  }),
  ptyWrite: z.object({ id: Id, data: z.string().max(200_000) }),
  ptyResize: z.object({ id: Id, cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(500) }),
  send: z.object({ id: Id, text: z.string().min(1).max(20_000), auto: z.boolean(), force: z.boolean().optional() }),
  recording: z.object({ recording: z.boolean() }),
  voicePreview: z.object({ voiceId: z.string().max(36) }),
  voiceCreate: z.object({ name: z.string().min(1).max(80) }),
  voiceDelete: z.object({ voiceId: z.string().max(36) }),
  audioEnded: z.object({ requestId: z.string().max(64) }),
  cloudProvider: z.object({ provider: z.enum(['openai', 'gemini']) }),
  cloudTest: z.object({ provider: z.enum(['openai', 'gemini']), ttsModel: z.string().max(80).optional(), voice: z.string().max(80).optional(), sttModel: z.string().max(80).optional(), style: z.string().max(300).optional() }),
  coachImprove: z.object({ text: z.string().min(1).max(6000) }),
  serviceSet: z.object({ name: z.enum(['stt', 'tts']), enabled: z.boolean() }),
  settingsPatch: z.record(z.string(), z.unknown()),
  text: z.object({ text: z.string().max(100_000) })
}
