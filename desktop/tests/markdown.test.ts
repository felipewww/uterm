import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/markdown'
import { extractVoiceSummary, stripVoiceTags } from '../src/shared/voiceTag'

describe('renderMarkdown', () => {
  it('escapes HTML so agent text can never inject markup', () => {
    const h = renderMarkdown('<img src=x onerror=alert(1)> **b** <script>x</script>')
    expect(h).not.toContain('<img')
    expect(h).not.toContain('<script')
    expect(h).toContain('&lt;img')
    expect(h).toContain('<strong>b</strong>')
  })
  it('renders headings, lists, inline and fenced code', () => {
    const h = renderMarkdown('## Title\n\n- one `x`\n- two\n\n1. a\n2. b\n\n```ts\nconst a = <b>\n```')
    expect(h).toContain('<p class="md-h">Title</p>')
    expect(h).toContain('<ul><li>one <code>x</code></li><li>two</li></ul>')
    expect(h).toContain('<ol><li>a</li><li>b</li></ol>')
    expect(h).toContain('<pre><code>const a = &lt;b&gt;</code></pre>')
  })
  it('reduces links to their text and survives an unclosed fence', () => {
    expect(renderMarkdown('see [docs](http://x.y)')).toBe('<p>see docs</p>')
    expect(renderMarkdown('```\ncode')).toContain('<pre>')
  })
})

describe('voice tags (shared)', () => {
  it('splits a response into summary and the rest', () => {
    const raw = 'Long text.\n\n<voice>Short version.</voice>'
    expect(extractVoiceSummary(raw)).toBe('Short version.')
    expect(stripVoiceTags(raw)).toBe('Long text.')
  })
})

import { isTagOnly, stripSpeechTags } from '../src/shared/voiceTag'
import { prepareSpeech, splitSentences } from '../src/main/voice/speechText'

describe('expressive speech tags', () => {
  it('are hidden from the displayed text but kept for speech', () => {
    expect(stripSpeechTags('Done! [chuckle] That one was sneaky. [happy] All pass.')).toBe('Done! That one was sneaky. All pass.')
    expect(stripSpeechTags('Use [0] as the index')).toBe('Use [0] as the index') // only known tags
    const spoken = prepareSpeech('Long reply.\n<voice>[happy] All tests pass! [chuckle] Finally.</voice>', { maxChars: 400 })
    expect(spoken).toBe('[happy] All tests pass! [chuckle] Finally.')
  })
  it('never leaves a tag alone in its own chunk', () => {
    const long = 'First sentence here that is quite long and keeps going for a while. ' + 'Second sentence is also fairly long so the chunk fills up nicely. '.repeat(2) + '[sigh]'
    expect(splitSentences(long, 120).every((c) => !isTagOnly(c))).toBe(true)
  })
})
