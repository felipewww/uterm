import { describe, expect, it } from 'vitest'
import { GEMINI_VOICES, OPENAI_VOICES, cloudVoiceId, cloudVoiceLabel, isCloudVoice, legacyDefaultVoice, parseVoiceId } from '../src/shared/voices'

describe('voice ids', () => {
  it('the provider is part of the id; plain ids are local voices', () => {
    expect(parseVoiceId('gemini:Kore')).toEqual({ provider: 'gemini', voice: 'Kore' })
    expect(parseVoiceId('openai:coral')).toEqual({ provider: 'openai', voice: 'coral' })
    expect(parseVoiceId('default')).toEqual({ provider: 'local', voice: 'default' })
    expect(parseVoiceId('3f2b6c1e-0000-4000-8000-000000000000').provider).toBe('local')
    expect(parseVoiceId(null)).toEqual({ provider: 'local', voice: 'default' })
    expect(isCloudVoice('gemini:Puck')).toBe(true)
    expect(isCloudVoice('default')).toBe(false)
    expect(cloudVoiceId('gemini', 'Aoede')).toBe('gemini:Aoede')
  })
  it('labels cloud voices with their character and fits the voice_profiles id column', () => {
    expect(cloudVoiceLabel('gemini:Kore')).toBe('Kore (Firm)')
    expect(cloudVoiceLabel('openai:coral')).toBe('coral')
    expect(cloudVoiceLabel('default')).toBeNull()
    for (const v of [...GEMINI_VOICES, ...OPENAI_VOICES]) expect(v.id.length).toBeLessThanOrEqual(36)
    expect(GEMINI_VOICES).toHaveLength(30)
  })

  it('carries an old global provider choice over to the default voice, once', () => {
    expect(legacyDefaultVoice({ ttsProvider: 'gemini', geminiVoice: 'Puck' }, 'default')).toBe('gemini:Puck')
    expect(legacyDefaultVoice({ ttsProvider: 'openai' }, 'default')).toBe('openai:coral')
    expect(legacyDefaultVoice({ ttsProvider: 'gemini' }, 'default')).toBe('gemini:Kore')
    expect(legacyDefaultVoice({ ttsProvider: 'local' }, 'default')).toBeNull()
    expect(legacyDefaultVoice({ ttsProvider: 'gemini' }, 'openai:coral')).toBeNull() // already a cloud default: leave it
    expect(legacyDefaultVoice({}, 'default')).toBeNull()
  })
})
