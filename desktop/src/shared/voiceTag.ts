/** The <voice>…</voice> summary Claude appends when speech instructions are on. Shared by the speech pipeline and the Activity panel. */
const VOICE_TAG = /<voice>([\s\S]*?)<\/voice>/gi
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

export function extractVoiceSummary(text: string): string | null {
  const matches = [...text.matchAll(VOICE_TAG)].map((m) => m[1]?.trim() ?? '').filter(Boolean)
  return matches.length ? collapse(matches.join(' ')) : null
}

export function stripVoiceTags(text: string): string {
  return text.replace(VOICE_TAG, '').trim()
}

/**
 * Chatterbox Turbo's expressive tags. They are spoken (as sounds/delivery), never shown: the chat displays the text without them.
 * Events: laugh, chuckle, sigh, gasp, groan, cough, clearthroat, sniff, shush. Delivery: happy, surprised, whispering, dramatic, narration, angry, fear, crying, sarcastic, advertisement.
 */
export const SPEECH_TAGS = ['laugh', 'chuckle', 'sigh', 'gasp', 'groan', 'cough', 'clearthroat', 'sniff', 'shush', 'happy', 'surprised', 'whispering', 'dramatic', 'narration', 'angry', 'fear', 'crying', 'sarcastic', 'advertisement'] as const
const SPEECH_TAG_RE = new RegExp(`\\s*\\[(?:${SPEECH_TAGS.join('|')})\\]`, 'gi')

export function stripSpeechTags(text: string): string {
  return text.replace(SPEECH_TAG_RE, '').replace(/\s+([.,!?;:])/g, '$1').replace(/^\s+|[ \t]+$/gm, '')
}
export const isTagOnly = (s: string): boolean => /^\[[a-z]+\]$/i.test(s.trim())
