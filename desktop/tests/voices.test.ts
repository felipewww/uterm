import { describe, expect, it } from 'vitest'
import { GEMINI_VOICES, OPENAI_VOICES, cloudVoiceId, cloudVoiceLabel, isCloudVoice, parseVoiceId } from '../src/shared/voices'

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
  it('labels cloud voices with their character and keeps ids short', () => {
    expect(cloudVoiceLabel('gemini:Kore')).toBe('Kore (Firm, Female)')
    expect(cloudVoiceLabel('openai:coral')).toBe('coral (Female)')
    expect(cloudVoiceLabel('default')).toBeNull()
    for (const v of [...GEMINI_VOICES, ...OPENAI_VOICES]) expect(v.id.length).toBeLessThanOrEqual(36)
    expect(GEMINI_VOICES).toHaveLength(30)
  })
})
