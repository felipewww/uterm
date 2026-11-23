import { stripSpeechTags } from '@shared/voiceTag'

/**
 * Cloud speech providers (opt-in; the default stays the local Docker services). Keys come from the environment
 * (typed in Settings and kept encrypted, see secrets.ts) and are only ever sent to the provider's own API host.
 * Everything here takes an injectable `fetch` so it can be unit-tested without a key.
 */
export type CloudProvider = 'openai' | 'gemini'
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface CloudConfig {
  getKey(p: CloudProvider): string | null
  fetch?: FetchLike
  openai: { ttsModel: string; sttModel: string }
  gemini: { ttsModel: string; sttModel: string }
  /** natural-language delivery style, e.g. "Say in a warm, friendly, upbeat way" */
  style: string
}

export interface Usage {
  provider: CloudProvider; model: string; kind: 'tts' | 'stt' | 'chat'
  /** what the provider reported or we measured */
  chars?: number; audioSeconds?: number; inputTokens?: number; outputTokens?: number
}

const OPENAI = 'https://api.openai.com/v1'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'

export class CloudError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

function need(cfg: CloudConfig, p: CloudProvider): string {
  const k = cfg.getKey(p)
  if (!k) throw new CloudError(`${p === 'openai' ? 'OpenAI' : 'Gemini'} key not set: add it in Settings → Voice engines.`)
  return k
}

/** Short, key-free explanation for a failed call. */
async function fail(res: Response, who: string, secret?: string): Promise<never> {
  let detail = ''
  try {
    const j = JSON.parse(await res.text()) as { error?: { message?: string } | string }
    detail = typeof j.error === 'string' ? j.error : j.error?.message ?? ''
  } catch { /* not JSON */ }
  if (secret) detail = detail.split(secret).join('***') // a provider may echo the key back in its message
  const hint = res.status === 401 || res.status === 403 ? 'the key was rejected' : res.status === 429 ? 'rate limited or out of quota' : res.status === 404 ? 'unknown model or endpoint' : `HTTP ${res.status}`
  throw new CloudError(`${who}: ${hint}${detail ? ` (${detail.slice(0, 160)})` : ''}`, res.status)
}

const f = (cfg: CloudConfig): FetchLike => cfg.fetch ?? ((u, i) => fetch(u, i))

export function pcm16ToWav(pcm: Uint8Array, rate = 24000, channels = 1): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const put = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  put(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); put(8, 'WAVEfmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true)
  v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/** Seconds of audio in a PCM WAV (0 when unreadable). */
export function wavSeconds(wav: Uint8Array): number {
  if (wav.length < 44) return 0
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const rate = v.getUint32(24, true); const ch = v.getUint16(22, true); const bits = v.getUint16(34, true)
  return rate && ch && bits ? (wav.length - 44) / (rate * ch * (bits / 8)) : 0
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

// ---------- OpenAI ----------
export async function openAiSpeak(cfg: CloudConfig, text: string, voice: string, signal?: AbortSignal): Promise<{ audio: Uint8Array; usage: Usage }> {
  const key = need(cfg, 'openai')
  const model = cfg.openai.ttsModel
  const input = stripSpeechTags(text) // [chuckle]/[happy] are Chatterbox tags: a cloud voice would read them aloud
  const body: Record<string, unknown> = { model, voice, input, response_format: 'wav' }
  if (model.startsWith('gpt-')) body.instructions = cfg.style // tts-1 / tts-1-hd ignore or reject it
  const res = await f(cfg)(`${OPENAI}/audio/speech`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) await fail(res, 'OpenAI speech', key)
  const audio = new Uint8Array(await res.arrayBuffer())
  return { audio, usage: { provider: 'openai', model, kind: 'tts', chars: input.length, audioSeconds: wavSeconds(audio) } }
}

export async function openAiTranscribe(cfg: CloudConfig, wav: Uint8Array): Promise<{ text: string; usage: Usage }> {
  const key = need(cfg, 'openai')
  const model = cfg.openai.sttModel
  const form = new FormData()
  form.append('file', new Blob([wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer], { type: 'audio/wav' }), 'recording.wav')
  form.append('model', model)
  const res = await f(cfg)(`${OPENAI}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) await fail(res, 'OpenAI transcription', key)
  const j = (await res.json()) as { text?: string; usage?: { seconds?: number; input_tokens?: number; output_tokens?: number } }
  return { text: (j.text ?? '').trim(), usage: { provider: 'openai', model, kind: 'stt', audioSeconds: j.usage?.seconds ?? wavSeconds(wav), inputTokens: j.usage?.input_tokens, outputTokens: j.usage?.output_tokens } }
}

// ---------- Gemini ----------
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType?: string; data?: string } }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { message?: string }
}

async function geminiCall(cfg: CloudConfig, model: string, body: unknown, signal?: AbortSignal, who = 'Gemini'): Promise<GeminiResponse> {
  const key = need(cfg, 'gemini')
  const res = await f(cfg)(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) await fail(res, who, key)
  return (await res.json()) as GeminiResponse
}

export async function geminiSpeak(cfg: CloudConfig, text: string, voice: string, signal?: AbortSignal): Promise<{ audio: Uint8Array; usage: Usage }> {
  const model = cfg.gemini.ttsModel
  const input = stripSpeechTags(text)
  const j = await geminiCall(cfg, model, {
    contents: [{ parts: [{ text: `${cfg.style}: ${input}` }] }], // Gemini TTS takes its delivery style from the prompt ("Say cheerfully: …")
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } }
  }, signal, 'Gemini speech')
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!part?.inlineData?.data) throw new CloudError('Gemini speech: the response contained no audio (the model may not support audio output).')
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? '')?.[1] ?? 24000) // raw 16-bit mono PCM, usually 24 kHz
  const audio = pcm16ToWav(fromB64(part.inlineData.data), rate)
  return { audio, usage: { provider: 'gemini', model, kind: 'tts', chars: input.length, audioSeconds: wavSeconds(audio), inputTokens: j.usageMetadata?.promptTokenCount, outputTokens: j.usageMetadata?.candidatesTokenCount } }
}

export async function geminiTranscribe(cfg: CloudConfig, wav: Uint8Array): Promise<{ text: string; usage: Usage }> {
  const model = cfg.gemini.sttModel
  const j = await geminiCall(cfg, model, {
    contents: [{ parts: [{ text: 'Transcribe this audio verbatim. Reply with only the transcript: no quotes, labels or commentary. If there is no speech, reply with nothing.' }, { inlineData: { mimeType: 'audio/wav', data: b64(wav) } }] }]
  }, AbortSignal.timeout(120_000), 'Gemini transcription')
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  return { text, usage: { provider: 'gemini', model, kind: 'stt', audioSeconds: wavSeconds(wav), inputTokens: j.usageMetadata?.promptTokenCount, outputTokens: j.usageMetadata?.candidatesTokenCount } }
}

// ---------- model discovery (also the cheapest way to check that a key works: it is free) ----------
export async function listModels(cfg: CloudConfig, provider: CloudProvider): Promise<{ tts: string[]; stt: string[] }> {
  const key = need(cfg, provider)
  if (provider === 'openai') {
    const res = await f(cfg)(`${OPENAI}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) await fail(res, 'OpenAI models', key)
    const ids = ((await res.json()) as { data?: Array<{ id: string }> }).data?.map((m) => m.id) ?? []
    return { tts: ids.filter((i) => /tts/.test(i)).sort(), stt: ids.filter((i) => /transcribe|whisper/.test(i) && !/diarize/.test(i)).sort() }
  }
  const res = await f(cfg)(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) await fail(res, 'Gemini models', key)
  const models = ((await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> }).models ?? []
  const ids = models.filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace(/^models\//, ''))
  return { tts: ids.filter((i) => /tts/.test(i)).sort(), stt: ids.filter((i) => /^gemini-[\d.]+-(flash|pro)(-lite)?$/.test(i)).sort() }
}
