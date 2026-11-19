import { describe, expect, it, vi } from 'vitest'
import { geminiSpeak, geminiTranscribe, listModels, openAiSpeak, openAiTranscribe, pcm16ToWav, wavSeconds, type CloudConfig } from '../src/main/voice/cloud'
import { estimateCost } from '../src/main/voice/pricing'
import { MemoryUsageStore } from '../src/main/db/usageStore'
import { SpeechRouter, selfTest } from '../src/main/voice/speechRouter'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/types'

const KEY = 'sk-test-SECRET-123'
const wavBytes = (seconds: number, rate = 24000) => pcm16ToWav(new Uint8Array(Math.round(seconds * rate) * 2), rate)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const cfg = (fetchImpl: CloudConfig['fetch'], keys: Partial<Record<'openai' | 'gemini', string | null>> = { openai: KEY, gemini: KEY }): CloudConfig => ({
  getKey: (p) => keys[p] ?? null, fetch: fetchImpl, style: 'Say warmly',
  openai: { ttsModel: 'gpt-4o-mini-tts', sttModel: 'gpt-4o-mini-transcribe' },
  gemini: { ttsModel: 'gemini-2.5-flash-preview-tts', sttModel: 'gemini-2.5-flash' }
})

describe('wav helpers', () => {
  it('wraps raw PCM in a valid header and measures it', () => {
    const w = pcm16ToWav(new Uint8Array(48000), 24000)
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF')
    expect(wavSeconds(w)).toBeCloseTo(1, 3)
  })
})

describe('OpenAI', () => {
  it('speaks: bearer auth, wav output, style instruction, and Chatterbox tags removed', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(wavBytes(2)))
    const r = await openAiSpeak(cfg(f), '[happy] Hello there! [chuckle] Nice.', 'coral')
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral', response_format: 'wav', instructions: 'Say warmly' })
    expect(body.input).toBe('Hello there! Nice.')
    expect(r.usage).toMatchObject({ provider: 'openai', kind: 'tts', model: 'gpt-4o-mini-tts' })
    expect(r.usage.audioSeconds).toBeCloseTo(2, 2)
  })
  it('does not send instructions to the older tts-1 models', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(wavBytes(1)))
    const c = cfg(f); c.openai.ttsModel = 'tts-1'
    await openAiSpeak(c, 'Hi', 'coral')
    expect(JSON.parse(f.mock.calls[0]![1]!.body as string).instructions).toBeUndefined()
  })
  it('transcribes with a multipart upload and reports usage', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json({ text: ' hello world ', usage: { type: 'duration', seconds: 4 } }))
    const r = await openAiTranscribe(cfg(f), wavBytes(3, 16000))
    expect(f.mock.calls[0]![0]).toBe('https://api.openai.com/v1/audio/transcriptions')
    const form = f.mock.calls[0]![1]!.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect(r.text).toBe('hello world')
    expect(r.usage.audioSeconds).toBe(4)
  })
  it('explains failures without leaking the key', async () => {
    const f = async () => json({ error: { message: `Incorrect API key provided: ${KEY}` } }, 401)
    const err = await openAiSpeak(cfg(f), 'Hi', 'coral').then(() => '', (e: Error) => e.message)
    expect(err).toMatch(/OpenAI speech: the key was rejected.*Incorrect API key/) // the provider's reason is shown…
    expect(err).not.toContain(KEY) // …but never the key, even if the provider echoes it
    await expect(openAiSpeak(cfg(async () => json({}, 429)), 'Hi', 'coral')).rejects.toThrow(/rate limited or out of quota/)
  })
  it('tells you which .env variable to set when there is no key', async () => {
    await expect(openAiSpeak(cfg(async () => json({}), { openai: null }), 'Hi', 'coral')).rejects.toThrow(/ECHO_TERM_OPENAI_API_KEY/)
    await expect(geminiSpeak(cfg(async () => json({}), { gemini: null }), 'Hi', 'Kore')).rejects.toThrow(/ECHO_TERM_GEMINI_API_KEY/)
  })
})

describe('Gemini', () => {
  it('speaks: key in a header (not the URL), style in the prompt, PCM turned into a WAV', async () => {
    const pcm = Buffer.from(new Uint8Array(24000 * 2)).toString('base64') // 1 s
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm } }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 25 }
    }))
    const r = await geminiSpeak(cfg(f), 'Good news [happy] it works', 'Kore')
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent')
    expect(url).not.toContain(KEY)
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY)
    const body = JSON.parse(init!.body as string)
    expect(body.contents[0].parts[0].text).toBe('Say warmly: Good news it works')
    expect(body.generationConfig).toMatchObject({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } })
    expect(wavSeconds(r.audio)).toBeCloseTo(1, 3)
    expect(r.usage).toMatchObject({ provider: 'gemini', kind: 'tts', inputTokens: 12, outputTokens: 25 })
  })
  it('reports a clear error when the model returns no audio', async () => {
    await expect(geminiSpeak(cfg(async () => json({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] })), 'Hi', 'Kore')).rejects.toThrow(/no audio/)
  })
  it('transcribes with inline audio and returns only the text', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json({ candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'there' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 3 } }))
    const r = await geminiTranscribe(cfg(f), wavBytes(2, 16000))
    const body = JSON.parse(f.mock.calls[0]![1]!.body as string)
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/wav')
    expect(r.text).toBe('hello there')
  })
})

describe('model discovery', () => {
  it('lists OpenAI voice and transcription models', async () => {
    const r = await listModels(cfg(async () => json({ data: [{ id: 'gpt-4o-mini-tts' }, { id: 'tts-1' }, { id: 'gpt-4o-mini-transcribe' }, { id: 'whisper-1' }, { id: 'gpt-4o-transcribe-diarize' }, { id: 'gpt-5' }] })), 'openai')
    expect(r.tts).toEqual(['gpt-4o-mini-tts', 'tts-1'])
    expect(r.stt).toEqual(['gpt-4o-mini-transcribe', 'whisper-1'])
  })
  it('lists Gemini models that can generate content', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json({ models: [
      { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }] }))
    const r = await listModels(cfg(f), 'gemini')
    expect(r.tts).toEqual(['gemini-2.5-flash-preview-tts'])
    expect(r.stt).toEqual(['gemini-2.5-flash'])
    expect(f.mock.calls[0]![0]).not.toContain(KEY)
  })
})

describe('estimated cost', () => {
  it('prices OpenAI by minute or by character, and Gemini by token', () => {
    expect(estimateCost({ provider: 'openai', model: 'gpt-4o-mini-tts', kind: 'tts', audioSeconds: 600 })).toBeCloseTo(0.15, 5)
    expect(estimateCost({ provider: 'openai', model: 'tts-1', kind: 'tts', chars: 1_000_000 })).toBeCloseTo(15, 5)
    expect(estimateCost({ provider: 'openai', model: 'gpt-4o-mini-transcribe', kind: 'stt', audioSeconds: 60 })).toBeCloseTo(0.003, 5)
    expect(estimateCost({ provider: 'gemini', model: 'gemini-2.5-flash-preview-tts', kind: 'tts', outputTokens: 1500, inputTokens: 0 })).toBeCloseTo(0.015, 5)
    expect(estimateCost({ provider: 'openai', model: 'something-new', kind: 'tts' })).toBeNull()
  })
})

describe('usage totals', () => {
  it('sums calls and cost by provider and kind, per period, and counts unpriced calls', async () => {
    const s = new MemoryUsageStore()
    const now = new Date('2026-11-19T15:00:00')
    await s.record({ provider: 'openai', model: 'gpt-4o-mini-tts', kind: 'tts', chars: 100, audioSeconds: 6, costUsd: 0.0015, at: now.getTime() })
    await s.record({ provider: 'openai', model: 'gpt-4o-mini-tts', kind: 'tts', chars: 50, audioSeconds: 3, costUsd: 0.0007, at: now.getTime() })
    await s.record({ provider: 'openai', model: 'new', kind: 'tts', costUsd: null, at: now.getTime() })
    await s.record({ provider: 'gemini', model: 'g', kind: 'stt', audioSeconds: 10, costUsd: 0.002, at: new Date('2026-10-01T10:00:00').getTime() })
    const sum = await s.summary(now)
    const tts = sum.today.find((r) => r.provider === 'openai')!
    expect(tts).toMatchObject({ calls: 3, chars: 150, unpriced: 1 })
    expect(tts.costUsd).toBeCloseTo(0.0022, 5)
    expect(sum.today.find((r) => r.provider === 'gemini')).toBeUndefined()
    expect(sum.all.find((r) => r.provider === 'gemini')!.calls).toBe(1)
  })
})

describe('SpeechRouter', () => {
  const setup = (over: Partial<AppSettings> = {}, fetchImpl?: CloudConfig['fetch']) => {
    const local = { tts: { synthesize: vi.fn(async () => new Uint8Array([1])), status: async () => ({ up: true, ready: true }) }, stt: { transcribe: vi.fn(async () => 'local text'), status: async () => ({ up: true }) } }
    const usage = new MemoryUsageStore()
    const settings = { ...DEFAULT_SETTINGS, ...over }
    const router = new SpeechRouter({ settings: () => settings, getKey: (p) => (p === 'openai' ? KEY : null), local: local as never, usage: () => usage, servicesOn: () => ({ stt: true, tts: true }), fetch: fetchImpl })
    return { router, local, usage }
  }
  it('a local voice id goes to the local service and records nothing', async () => {
    const { router, local, usage } = setup()
    expect(await router.synthesize('hi', 'default', new AbortController().signal)).toEqual(new Uint8Array([1]))
    expect(local.tts.synthesize).toHaveBeenCalledWith('hi', 'default', expect.anything())
    expect((await usage.summary()).all).toEqual([])
  })
  it('the provider comes from the voice id, so different chats can use different providers', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const { router, local, usage } = setup({}, async (url, init) => { calls.push({ url, body: String(init?.body) }); return new Response(wavBytes(6)) })
    await router.synthesize('Hello', 'openai:coral', new AbortController().signal)
    await router.synthesize('Hello', 'default', new AbortController().signal)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ voice: 'coral', model: 'gpt-4o-mini-tts' })
    expect(local.tts.synthesize).toHaveBeenCalledTimes(1)
    await new Promise((r) => setTimeout(r, 0))
    const row = (await usage.summary()).all[0]!
    expect(row).toMatchObject({ provider: 'openai', kind: 'tts', calls: 1 })
    expect(row.costUsd).toBeCloseTo(0.0015, 5)
  })
  it('usability is decided per voice: cloud voices need their key, local voices need the service', () => {
    const { router } = setup()
    expect(router.ttsUsable('openai:coral')).toBe(true)
    expect(router.ttsUsable('gemini:Kore')).toBe(false) // no Gemini key in this test
    expect(router.ttsUsable('default')).toBe(true)
    expect(router.voiceKey('openai:coral')).toContain('openai|gpt-4o-mini-tts')
    expect(router.voiceKey('gemini:Kore')).toContain('gemini|')
    expect(router.voiceKey('default')).toBe('local')
  })
  it('status reports the local services, whichever provider is selected', async () => {
    expect(await setup().router.status()).toEqual({ stt: true, tts: true, ttsReady: true })
    expect(await setup({ sttProvider: 'gemini' }).router.status()).toEqual({ stt: true, tts: true, ttsReady: true })
  })
  it('self-test: key missing short-circuits; with a key it checks, speaks and transcribes, and bills it to the usage totals', async () => {
    const none = setup({}, async () => json({}))
    expect((await selfTest(none.router, 'gemini', {}, 'Kore', () => undefined)).steps).toHaveLength(1)
    const { router, usage } = setup({}, async (url) => {
      if (url.endsWith('/models')) return json({ data: [{ id: 'gpt-4o-mini-tts' }, { id: 'gpt-4o-mini-transcribe' }] })
      if (url.endsWith('/audio/speech')) return new Response(wavBytes(5))
      return json({ text: 'hello this is a test', usage: { seconds: 5 } })
    })
    const played: Uint8Array[] = []
    const r = await selfTest(router, 'openai', {}, 'coral', (w) => played.push(w))
    expect(r.steps.map((s) => s.ok)).toEqual([true, true, true, true])
    expect(played).toHaveLength(1)
    expect(r.costUsd).toBeGreaterThan(0)
    await new Promise((x) => setTimeout(x, 0))
    expect((await usage.summary()).all.map((x) => x.kind).sort()).toEqual(['stt', 'tts'])
  })
})
