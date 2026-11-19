import { describe, expect, it, vi } from 'vitest'
import { VoiceCoordinator, type VoiceDeps } from '../src/main/voice/voiceCoordinator'
import { DEFAULT_SETTINGS, type AppSettings, type SessionRecord } from '../src/shared/types'

const session = {
  id: 's1', title: 'My project', voiceProfileId: null, playbackSpeed: null, foregroundVoiceMode: 'silent', backgroundVoiceMode: 'silent'
} as unknown as SessionRecord
const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: { muted?: boolean; settings?: Partial<AppSettings> } = {}) {
  const spoken: string[] = []
  const states: Array<{ speakingEventId: string | null }> = []
  const deps = {
    getSession: () => session,
    isMuted: () => !!opts.muted,
    settings: () => ({ ...DEFAULT_SETTINGS, ...opts.settings }),
    focus: () => ({ selectedSessionId: 's2', windowFocused: true }), // s1 is a background session
    synthesize: vi.fn(async (text: string) => new TextEncoder().encode(text)),
    play: vi.fn(async (audio: Uint8Array) => { spoken.push(new TextDecoder().decode(audio)) }),
    stopPlayback: vi.fn(),
    onSpoken: vi.fn(),
    onState: (s: { speakingEventId: string | null }) => { states.push(s) },
    onError: vi.fn()
  } satisfies VoiceDeps
  return { voice: new VoiceCoordinator(deps), deps, spoken, states }
}

describe('VoiceCoordinator.listen (listen again from the activity panel)', () => {
  it('speaks even when the session is muted and its modes are silent, without a title prefix', async () => {
    const { voice, spoken } = setup({ muted: true })
    expect(voice.listen('s1', 'The build finished.', 'evt-1')).toBe(true)
    await tick(); await tick()
    expect(spoken).toEqual(['The build finished.'])
  })

  it('is still blocked by the system-wide mute', async () => {
    const { voice, deps, spoken } = setup({ settings: { globalMute: true } })
    voice.listen('s1', 'The build finished.', 'evt-1')
    await tick(); await tick()
    expect(spoken).toEqual([])
    expect(deps.synthesize).not.toHaveBeenCalled()
  })

  it('does not record the replay as a new spoken message', async () => {
    const { voice, deps } = setup()
    voice.listen('s1', 'The build finished.', 'evt-1')
    await tick(); await tick()
    expect(deps.onSpoken).not.toHaveBeenCalled()
  })

  it('reports which activity item is playing', async () => {
    const { voice, states } = setup()
    voice.listen('s1', 'The build finished.', 'evt-9')
    await tick(); await tick()
    expect(states.some((s) => s.speakingEventId === 'evt-9')).toBe(true)
    expect(states.at(-1)?.speakingEventId).toBeNull()
  })

  it('reuses synthesized audio when the same message is played again', async () => {
    const { voice, deps, spoken } = setup()
    voice.listen('s1', 'The build finished.', 'evt-1'); await tick(); await tick()
    voice.listen('s1', 'The build finished.', 'evt-1'); await tick(); await tick()
    expect(spoken).toHaveLength(2)
    expect(deps.synthesize).toHaveBeenCalledTimes(1)
  })

  it('ignores unknown sessions and empty text', () => {
    const { voice } = setup()
    expect(voice.listen('s1', '   ', 'evt-1')).toBe(false)
  })
})
