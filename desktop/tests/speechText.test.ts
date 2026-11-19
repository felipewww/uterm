import { describe, expect, it } from 'vitest'
import { cleanForSpeech, extractVoiceSummary, limitLength, prepareSpeech, splitSentences } from '../src/main/voice/speechText'

describe('speech text', () => {
  it('prefers the <voice> summary over the whole response', () => {
    const raw = 'Long details...\n```ts\nconst x = 1\n```\n<voice>\nAll 24 tests passed.\nI fixed the token refresh.\n</voice>'
    expect(prepareSpeech(raw, { maxChars: 500 })).toBe('All 24 tests passed. I fixed the token refresh.')
    expect(extractVoiceSummary('no tags')).toBeNull()
  })
  it('removes code, diffs, shell, stack traces, tables, paths and urls', () => {
    const raw = [
      'I found the problem in token handling.',
      '```bash\nnpm test\n```',
      '$ npm run build',
      '    at foo (/app/src/a.ts:10:5)',
      '| a | b |',
      'src/auth/token.ts',
      '--- a/file', '+++ b/file', '@@ -1,2 +1,2 @@',
      'See https://example.com/doc for more.',
      'Then I ran the tests.'
    ].join('\n')
    const out = cleanForSpeech(raw)
    expect(out).toBe('I found the problem in token handling. See for more. Then I ran the tests.')
  })
  it('strips markdown decoration but keeps short inline identifiers', () => {
    expect(cleanForSpeech('## Result\n- **Fixed** the `parseToken` bug')).toBe('Result Fixed the parseToken bug')
  })
  it('returns null when nothing speakable remains', () => {
    expect(prepareSpeech('```\ncode only\n```', { maxChars: 500 })).toBeNull()
  })
  it('limits length at a sentence boundary without fabricating a summary', () => {
    const t = 'First sentence is here. Second sentence goes on and on. Third sentence is cut off somewhere.'
    const out = limitLength(t, 60)
    expect(out).toBe('First sentence is here. Second sentence goes on and on.')
    expect(t.startsWith(out)).toBe(true)
  })
  it('splits into sentence chunks with a short first chunk', () => {
    const chunks = splitSentences('One. Two! Three?')
    expect(chunks.join(' ')).toBe('One. Two! Three?')
    const long = 'This is a really long opening clause that keeps going and going for quite a while, and then it finally ends here. Next one.'
    expect(splitSentences(long)[0]!.length).toBeLessThanOrEqual(140)
  })
})
