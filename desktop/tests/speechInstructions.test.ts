import { describe, expect, it } from 'vitest'
import { PLAIN_SPEECH_INSTRUCTIONS, SPEECH_INSTRUCTIONS } from '../src/main/speechInstructions'

describe('speech instructions', () => {
  it('ask for expressive tags only in the full set', () => {
    expect(SPEECH_INSTRUCTIONS).toContain('[chuckle]')
    expect(PLAIN_SPEECH_INSTRUCTIONS).not.toMatch(/chuckle|Expressive tags|\[happy\]/)
  })
  it('keep the spoken summary rule either way', () => {
    expect(PLAIN_SPEECH_INSTRUCTIONS).toContain('<voice></voice>')
    expect(SPEECH_INSTRUCTIONS.startsWith(PLAIN_SPEECH_INSTRUCTIONS)).toBe(true)
  })
})
