import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanTranscript } from '../src/main/voice/nativeStt'
import { TtsClient } from '../src/main/voice/ttsClient'

let srv: http.Server | undefined
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())))

async function serve(handler: http.RequestListener): Promise<string> {
  srv = http.createServer(handler)
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
}

describe('cleanTranscript', () => {
  it('strips non-speech markers', () => {
    expect(cleanTranscript('(music) hello  [NOISE]  world')).toBe('hello world')
  })
})

describe('TtsClient', () => {
  it('synthesizes with the requested voice and returns audio bytes', async () => {
    let body: any
    const url = await serve((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { body = JSON.parse(b); res.setHeader('content-type', 'audio/wav'); res.end(Buffer.from([1, 2, 3])) })
    })
    const audio = await new TtsClient(() => url).synthesize('Hello there.', 'voice-1', new AbortController().signal)
    expect(body).toEqual({ text: 'Hello there.', voice_id: 'voice-1' })
    expect([...audio]).toEqual([1, 2, 3])
  })
  it('surfaces failures (so the audio queue can recover) and honours abort', async () => {
    const url = await serve((_req, res) => { res.statusCode = 503; res.end('model not ready') })
    await expect(new TtsClient(() => url).synthesize('x', 'default', new AbortController().signal)).rejects.toThrow(/TTS 503/)
    const slow = await serve(() => { /* never responds */ })
    const ac = new AbortController(); setTimeout(() => ac.abort(), 30)
    await expect(new TtsClient(() => slow).synthesize('x', 'default', ac.signal)).rejects.toThrow()
  })
  it('status distinguishes down / loading / ready', async () => {
    const url = await serve((req, res) => { res.statusCode = req.url === '/ready' ? 503 : 200; res.end('{}') })
    expect(await new TtsClient(() => url).status()).toEqual({ up: true, ready: false })
    expect(await new TtsClient(() => 'http://127.0.0.1:9').status()).toEqual({ up: false, ready: false })
  })
})
