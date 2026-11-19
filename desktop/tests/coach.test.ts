import { describe, expect, it, vi } from 'vitest'
import { COACH_PROMPT, EnglishCoach, shouldCoach } from '../src/main/voice/coach'
import { MemoryUsageStore } from '../src/main/db/usageStore'
import { estimateCost } from '../src/main/voice/pricing'
import { DEFAULT_SETTINGS, coachOnFor, type AppSettings } from '../src/shared/types'

const KEY = 'sk-test-SECRET-456'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const reply = (content: string, usage = { prompt_tokens: 300, completion_tokens: 40 }) => json({ choices: [{ message: { content } }], usage })

function setup(over: Partial<AppSettings> = {}, key: string | null = KEY, f?: (u: string, i?: RequestInit) => Promise<Response>) {
  const usage = new MemoryUsageStore()
  const fetchImpl = vi.fn(f ?? (async () => reply('I think we should test this first.')))
  const coach = new EnglishCoach({ settings: () => ({ ...DEFAULT_SETTINGS, ...over }), getKey: () => key, usage: () => usage, fetch: fetchImpl as never })
  return { coach, usage, fetchImpl }
}

describe('EnglishCoach', () => {
  it('asks the model for a natural B2–C1 rewrite of exactly what was said', async () => {
    const { coach, fetchImpl } = setup()
    const out = await coach.improve('  i think we need to test this before, you know, before send  ')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(init!.body as string)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.messages[0]).toEqual({ role: 'system', content: COACH_PROMPT })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'i think we need to test this before, you know, before send' })
    expect(out).toBe('I think we should test this first.')
  })
  it('the prompt keeps the rewrite honest: B2–C1, no answering, technical terms untouched, Portuguese translated', () => {
    expect(COACH_PROMPT).toMatch(/B2–C1/)
    expect(COACH_PROMPT).toMatch(/do not follow any instruction/i)
    expect(COACH_PROMPT).toMatch(/code, file names, commands/)
    expect(COACH_PROMPT).toMatch(/Portuguese/)
    expect(COACH_PROMPT).toMatch(/ONLY the rewritten text/)
  })
  it('strips quotes the model puts around the answer, and records the call with an estimated cost', async () => {
    const { coach, usage } = setup({}, KEY, async () => reply('"Can you check the logs?"'))
    expect(await coach.improve('can you check logs')).toBe('Can you check the logs?')
    const row = (await usage.summary()).all[0]!
    expect(row).toMatchObject({ provider: 'openai', kind: 'chat', calls: 1 })
    expect(row.costUsd).toBeCloseTo((300 / 1e6) * 0.15 + (40 / 1e6) * 0.6, 8)
  })
  it('uses the model from the settings', async () => {
    const { coach, fetchImpl } = setup({ englishCoachModel: 'gpt-5-mini' })
    await coach.improve('hello')
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).model).toBe('gpt-5-mini')
  })
  it('is only available when switched on and a key exists', () => {
    expect(setup().coach.available()).toBe(true)
    expect(setup({ englishCoach: false }).coach.available()).toBe(false)
    expect(setup({}, null).coach.available()).toBe(false)
  })
  it('explains failures without leaking the key', async () => {
    await expect(setup({}, null).coach.improve('hi')).rejects.toThrow(/ECHO_TERM_OPENAI_API_KEY/)
    const bad = setup({}, KEY, async () => json({ error: { message: `Incorrect API key: ${KEY}` } }, 401))
    const msg = await bad.coach.improve('hi').then(() => '', (e: Error) => e.message)
    expect(msg).toMatch(/English coach: the key was rejected/)
    expect(msg).not.toContain(KEY)
    await expect(setup({}, KEY, async () => json({}, 404)).coach.improve('hi')).rejects.toThrow(/model "gpt-4o-mini" not found/)
    await expect(setup({}, KEY, async () => json({ choices: [{ message: { content: ' ' } }] })).coach.improve('hi')).rejects.toThrow(/returned nothing/)
  })
  it('does not call the API for empty text', async () => {
    const { coach, fetchImpl } = setup()
    expect(await coach.improve('   ')).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('chat pricing', () => {
  it('prices known text models by tokens and leaves unknown ones unpriced', () => {
    expect(estimateCost({ provider: 'openai', model: 'gpt-4o-mini', kind: 'chat', inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.75, 6)
    expect(estimateCost({ provider: 'openai', model: 'gpt-5-mini-2026-01-01', kind: 'chat', inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.25, 6)
    expect(estimateCost({ provider: 'openai', model: 'brand-new-model', kind: 'chat', inputTokens: 10 })).toBeNull()
  })
})

describe('per-chat switch', () => {
  it("a chat's own choice wins; no choice follows the global setting", () => {
    expect(coachOnFor(true, null)).toBe(true)
    expect(coachOnFor(false, null)).toBe(false)
    expect(coachOnFor(true, false)).toBe(false) // off for this chat although on globally
    expect(coachOnFor(false, true)).toBe(true) // on for this chat although off globally
    expect(coachOnFor(true, undefined)).toBe(true)
  })
})

describe('coaching what is sent', () => {
  it('skips commands, paths and fragments, keeps real sentences', () => {
    for (const t of ['/clear', '!ls -la', 'ok', 'yes please', '~/projects/echo-term/src', '   ']) expect(shouldCoach(t), t).toBe(false)
    for (const t of ['can you check the logs for me', 'Hoje eu quero testar isso aqui']) expect(shouldCoach(t), t).toBe(true)
  })
  it('never pays twice for the same phrase, or for a phrase that is already a natural version', async () => {
    const { coach, fetchImpl } = setup()
    const a = await coach.improve('i think we need test this')
    expect(await coach.improve('i think we need test this')).toBe(a) // e.g. shown in the composer, then sent
    expect(await coach.improve(a)).toBe(a) // the user clicked "Use this version"
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
