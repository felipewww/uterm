/**
 * Deterministic text preparation for speech. No LLM involved.
 * Order of preference: <voice> summary > cleaned prose (length-limited).
 */

import { extractVoiceSummary, isTagOnly, stripVoiceTags } from '@shared/voiceTag'
export { extractVoiceSummary, stripVoiceTags }

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

function looksLikeLog(line: string): boolean {
  const t = line.trim()
  if (/^(\$|>|#!)\s?/.test(t)) return true
  if (/^\s*at\s+\S+\s+\(.*:\d+:\d+\)/.test(line)) return true // stack frame
  if (/^(diff --git|index [0-9a-f]+\.\.|@@ |\+\+\+ |--- )/.test(t)) return true
  if (/^[+-]\s/.test(t) && /[{};=]/.test(t)) return true
  if (/^\|.*\|$/.test(t)) return true // table row
  if (/^(\/|\.\/|~\/)?[\w.-]+(\/[\w.-]+)+\.\w+(:\d+)?$/.test(t)) return true // bare file path
  if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(t)) return true // timestamped log
  if (/^(Traceback|Error:|TypeError|ReferenceError|Exception in)/.test(t)) return true
  return false
}

export function cleanForSpeech(text: string): string {
  let t = stripVoiceTags(text)
  t = t.replace(/```[\s\S]*?```/g, ' ') // fenced code
  t = t.replace(/~~~[\s\S]*?~~~/g, ' ')
  t = t.split('\n').filter((l) => !looksLikeLog(l)).join('\n')
  t = t.replace(/`([^`\n]{1,40})`/g, '$1') // short inline code is fine to read
  t = t.replace(/`[^`\n]*`/g, ' ') // long inline code (commands) is not
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  t = t.replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
  t = t.replace(/https?:\/\/\S+/g, ' ')
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+[.)]\s+/gm, '')
  t = t.replace(/[*_]{1,3}([^*_\n]+)[*_]{1,3}/g, '$1')
  t = t.replace(/\s*[|]{2,}\s*/g, ' ')
  return collapse(t)
}

/** Cut at a sentence boundary under `max` chars; never mid-word. */
export function limitLength(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastStop > max * 0.4) return cut.slice(0, lastStop + 1)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd() + '.'
}

export interface SpeechOptions { maxChars: number }

/** Returns speakable text or null when nothing suitable remains. */
export function prepareSpeech(raw: string, opts: SpeechOptions): string | null {
  const summary = extractVoiceSummary(raw)
  const base = summary ?? cleanForSpeech(raw)
  if (!/[A-Za-z]{3}/.test(base)) return null
  return limitLength(base, opts.maxChars)
}

/** Split into sentence-sized chunks so playback can start before the whole text is synthesised. */
export function splitSentences(text: string, maxChunk = 220): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
    if (cur && !isTagOnly(s) && (cur + ' ' + s).length > maxChunk) { chunks.push(cur); cur = s } else cur = cur ? cur + ' ' + s : s
  }
  if (cur) chunks.push(cur)
  // First chunk short => lower time-to-first-audio.
  const first = chunks[0]
  if (first && first.length > 140) {
    const i = first.lastIndexOf(', ', 140)
    if (i > 40) { chunks.splice(0, 1, first.slice(0, i + 1), first.slice(i + 2)) }
  }
  return chunks
}
