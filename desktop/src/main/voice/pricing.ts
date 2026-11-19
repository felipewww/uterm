import type { Usage } from './cloud'

/**
 * ESTIMATED cost in US dollars from the usage a provider reported (or that we measured). Prices are public list prices as read
 * in November 2026 and can change: treat the totals as estimates and check the provider dashboards for the real bill.
 * Returns null for a model we have no price for (usage is still recorded).
 */
export function estimateCost(u: Usage, now = new Date()): number | null {
  const min = (u.audioSeconds ?? 0) / 60
  const M = 1_000_000
  if (u.provider === 'openai') {
    if (u.kind === 'tts') {
      if (/^gpt-4o-mini-tts/.test(u.model)) return min * 0.015 // OpenAI's own per-minute estimate for this model
      if (u.model.startsWith('tts-1-hd')) return ((u.chars ?? 0) / M) * 30
      if (u.model.startsWith('tts-1')) return ((u.chars ?? 0) / M) * 15
      return null
    }
    if (/mini-transcribe/.test(u.model)) return min * 0.003
    if (/transcribe|whisper/.test(u.model)) return min * 0.006
    return null
  }
  if (u.kind === 'tts') {
    // audio output tokens ($/1M) + text input tokens (assumed $0.50/1M)
    const out = /3\.8/.test(u.model) ? (now < new Date('2027-01-01T00:00:00Z') ? 9 : 18) : 10
    return ((u.outputTokens ?? 0) / M) * out + ((u.inputTokens ?? 0) / M) * 0.5
  }
  // Gemini Flash transcription: audio in ($1.00/1M assumed), text out ($2.50/1M assumed)
  return ((u.inputTokens ?? 0) / M) * 1.0 + ((u.outputTokens ?? 0) / M) * 2.5
}
