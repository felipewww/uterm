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

export type VoiceGender = 'Female' | 'Male' | 'Neutral'
export interface CloudVoice { id: string; name: string; trait?: string; gender: VoiceGender }

const F = 'Female', M = 'Male'
// Gemini's prebuilt voices, with the character and the gender Google lists for each one.
export const GEMINI_VOICES: CloudVoice[] = ([
  ['Zephyr', 'Bright', F], ['Puck', 'Upbeat', M], ['Charon', 'Informative', M], ['Kore', 'Firm', F], ['Fenrir', 'Excitable', M], ['Leda', 'Youthful', F], ['Orus', 'Firm', M],
  ['Aoede', 'Breezy', F], ['Callirrhoe', 'Easy-going', F], ['Autonoe', 'Bright', F], ['Enceladus', 'Breathy', M], ['Iapetus', 'Clear', M], ['Umbriel', 'Easy-going', M],
  ['Algieba', 'Smooth', M], ['Despina', 'Smooth', F], ['Erinome', 'Clear', F], ['Algenib', 'Gravelly', M], ['Rasalgethi', 'Informative', M], ['Laomedeia', 'Upbeat', F],
  ['Achernar', 'Soft', F], ['Alnilam', 'Firm', M], ['Schedar', 'Even', M], ['Gacrux', 'Mature', F], ['Pulcherrima', 'Forward', F], ['Achird', 'Friendly', M],
  ['Zubenelgenubi', 'Casual', M], ['Vindemiatrix', 'Gentle', F], ['Sadachbia', 'Lively', M], ['Sadaltager', 'Knowledgeable', M], ['Sulafat', 'Warm', F]
] as const).map(([name, trait, gender]) => ({ id: cloudVoiceId('gemini', name), name, trait, gender }))

// OpenAI does not state a gender for its voices: these are how they are generally heard (alloy sits in between).
const OPENAI_GENDER: Record<string, VoiceGender> = { alloy: 'Neutral', ash: M, ballad: M, coral: F, echo: M, fable: M, nova: F, onyx: M, sage: F, shimmer: F, verse: M, marin: F, cedar: M }
export const OPENAI_VOICES: CloudVoice[] = Object.keys(OPENAI_GENDER).map((name) => ({ id: cloudVoiceId('openai', name), name, gender: OPENAI_GENDER[name]! }))

/** The text of one entry in a voice list: "Kore · Firm · Female", "coral · Female". */
export const voiceOptionLabel = (v: CloudVoice): string => [v.name, v.trait, v.gender].filter(Boolean).join(' · ')

/** "Kore (Firm, Female)" for a cloud voice; the profile name for a local one (looked up by the caller). */
export function cloudVoiceLabel(id: string): string | null {
  const v = [...GEMINI_VOICES, ...OPENAI_VOICES].find((x) => x.id === id)
  if (v) return `${v.name} (${[v.trait, v.gender].filter(Boolean).join(', ')})`
  const p = parseVoiceId(id)
  return p.provider === 'local' ? null : p.voice
}
