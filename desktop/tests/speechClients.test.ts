import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { SttClient, cleanTranscript } from '../src/main/voice/sttClient'
import { TtsClient } from '../src/main/voice/ttsClient'

let srv: http.Server | undefined
afterEach(() => new Promise<void>((r) => (srv ? srv.close(() => r()) : r())))

async function serve(handler: http.RequestListener): Promise<string> {
  srv = http.createServer(handler)
  await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
}

describe('SttClient', () => {
  it('posts multipart audio to /inference and cleans the transcript', async () => {
    let contentType = ''
    const url = await serve((req, res) => {
      contentType = String(req.headers['content-type'])
      expect(req.url).toBe('/inference')
      req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: ' [BLANK_AUDIO] Fix the login bug.\n ' })) })
    })
    const text = await new SttClient(() => url).transcribe(new Uint8Array(100))
    expect(contentType).toMatch(/multipart\/form-data/)
    expect(text).toBe('Fix the login bug.')
  })
  it('reports server errors; status() is false when the service is down', async () => {
    const url = await serve((_req, res) => { res.statusCode = 500; res.end('boom') })
    await expect(new SttClient(() => url).transcribe(new Uint8Array(10))).rejects.toThrow(/STT 500/)
    expect((await new SttClient(() => 'http://127.0.0.1:9').status()).up).toBe(false)
  })
  it('cleanTranscript strips non-speech markers', () => {
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
