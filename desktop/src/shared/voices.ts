/**
 * One voice id format for everything. A voice is either a local profile (the plain id the TTS service knows: "default", or a
 * cloned voice's uuid) or a cloud voice: "gemini:Kore", "openai:coral". The provider is therefore a property of the voice, so a
 * chat can use a cloud voice while another uses a local one.
 */
export type VoiceProvider = 'local' | 'openai' | 'gemini'

export function parseVoiceId(id: string | null | undefined): { provider: VoiceProvider; voice: string } {
  const m = /^(openai|gemini):(.+)$/.exec(id ?? '')
  return m ? { provider: m[1] as VoiceProvider, voice: m[2]! } : { provider: 'local', voice: id || 'default' }
}
export const cloudVoiceId = (provider: 'openai' | 'gemini', voice: string): string => `${provider}:${voice}`
export const isCloudVoice = (id: string | null | undefined): boolean => parseVoiceId(id).provider !== 'local'

export interface CloudVoice { id: string; name: string; trait?: string }

// Gemini's prebuilt voices, with the character Google gives each one.
export const GEMINI_VOICES: CloudVoice[] = ([
  ['Zephyr', 'Bright'], ['Puck', 'Upbeat'], ['Charon', 'Informative'], ['Kore', 'Firm'], ['Fenrir', 'Excitable'], ['Leda', 'Youthful'], ['Orus', 'Firm'],
  ['Aoede', 'Breezy'], ['Callirrhoe', 'Easy-going'], ['Autonoe', 'Bright'], ['Enceladus', 'Breathy'], ['Iapetus', 'Clear'], ['Umbriel', 'Easy-going'],
  ['Algieba', 'Smooth'], ['Despina', 'Smooth'], ['Erinome', 'Clear'], ['Algenib', 'Gravelly'], ['Rasalgethi', 'Informative'], ['Laomedeia', 'Upbeat'],
  ['Achernar', 'Soft'], ['Alnilam', 'Firm'], ['Schedar', 'Even'], ['Gacrux', 'Mature'], ['Pulcherrima', 'Forward'], ['Achird', 'Friendly'],
  ['Zubenelgenubi', 'Casual'], ['Vindemiatrix', 'Gentle'], ['Sadachbia', 'Lively'], ['Sadaltager', 'Knowledgeable'], ['Sulafat', 'Warm']
] as const).map(([name, trait]) => ({ id: cloudVoiceId('gemini', name), name, trait }))

export const OPENAI_VOICES: CloudVoice[] = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar']
  .map((name) => ({ id: cloudVoiceId('openai', name), name }))

/** "Kore (Firm)" for a cloud voice; the profile name for a local one (looked up by the caller). */
export function cloudVoiceLabel(id: string): string | null {
  const v = [...GEMINI_VOICES, ...OPENAI_VOICES].find((x) => x.id === id)
  if (v) return v.trait ? `${v.name} (${v.trait})` : v.name
  const p = parseVoiceId(id)
  return p.provider === 'local' ? null : p.voice
}

/**
 * Earlier builds stored a global "voice provider" plus one voice per provider. Returns the default voice id that carries that choice
 * over (null when there is nothing to migrate or the default is already a cloud voice).
 */
export function legacyDefaultVoice(legacy: Record<string, unknown>, currentDefault: string): string | null {
  const p = legacy.ttsProvider
  if ((p !== 'openai' && p !== 'gemini') || isCloudVoice(currentDefault)) return null
  const stored = legacy[p === 'openai' ? 'openaiVoice' : 'geminiVoice']
  return cloudVoiceId(p, typeof stored === 'string' && stored ? stored : p === 'openai' ? 'coral' : 'Kore')
}
