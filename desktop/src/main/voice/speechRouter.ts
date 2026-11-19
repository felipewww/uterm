import type { AppSettings, SpeechProvider } from '@shared/types'
import { parseVoiceId } from '@shared/voices'
import { SttClient } from './sttClient'
import type { TtsClient } from './ttsClient'
import { CloudError, geminiSpeak, geminiTranscribe, listModels, openAiSpeak, openAiTranscribe, type CloudConfig, type CloudProvider, type FetchLike, type Usage } from './cloud'
import { estimateCost } from './pricing'
import type { UsageRepository } from '../db/usageStore'
import type { ServiceFlags } from '../services'

export interface RouterDeps {
  settings(): AppSettings
  getKey(p: CloudProvider): string | null
  local: { tts: TtsClient; stt: SttClient }
  usage(): UsageRepository | null
  servicesOn(): ServiceFlags
  fetch?: FetchLike
  onError?(message: string): void
}

/** Sends speech to the provider chosen in Settings (local Docker service by default) and keeps the estimated cloud spend. */
export class SpeechRouter {
  constructor(private d: RouterDeps) {}

  hasKey(p: CloudProvider): boolean { return !!this.d.getKey(p) }

  cloudConfig(over: Partial<{ ttsModel: string; sttModel: string; style: string }> = {}, provider?: CloudProvider): CloudConfig {
    const s = this.d.settings()
    const cfg: CloudConfig = {
      getKey: this.d.getKey, fetch: this.d.fetch, style: s.cloudVoiceStyle,
      openai: { ttsModel: s.openaiTtsModel, sttModel: s.openaiSttModel },
      gemini: { ttsModel: s.geminiTtsModel, sttModel: s.geminiSttModel }
    }
    if (provider) {
      if (over.ttsModel) cfg[provider].ttsModel = over.ttsModel
      if (over.sttModel) cfg[provider].sttModel = over.sttModel
    }
    if (over.style) cfg.style = over.style
    return cfg
  }

  /** Part of the synthesis cache key: audio made with one provider, model or style must never be replayed for another. (The voice itself is in the key already.) */
  voiceKey(voiceId: string): string {
    const s = this.d.settings()
    const p = parseVoiceId(voiceId).provider
    return p === 'openai' ? `openai|${s.openaiTtsModel}|${s.cloudVoiceStyle}` : p === 'gemini' ? `gemini|${s.geminiTtsModel}|${s.cloudVoiceStyle}` : 'local'
  }

  /** Can this voice be produced right now? Local voices need the Docker service on; cloud voices need their key. */
  ttsUsable(voiceId: string): boolean { const p = parseVoiceId(voiceId).provider; return p === 'local' ? this.d.servicesOn().tts : this.hasKey(p) }
  sttUsable(): boolean { const p = this.d.settings().sttProvider; return p === 'local' ? this.d.servicesOn().stt : this.hasKey(p) }

  async record(u: Usage): Promise<void> {
    try { await this.d.usage()?.record({ ...u, costUsd: estimateCost(u) }) } catch { /* a usage row must never break speech */ }
  }

  async synthesize(text: string, voiceId: string, signal: AbortSignal): Promise<Uint8Array> {
    const { provider, voice } = parseVoiceId(voiceId)
    if (provider === 'local') return this.d.local.tts.synthesize(text, voiceId, signal)
    const r = provider === 'openai' ? await openAiSpeak(this.cloudConfig(), text, voice, signal) : await geminiSpeak(this.cloudConfig(), text, voice, signal)
    void this.record(r.usage)
    return r.audio
  }

  async transcribe(wav: Uint8Array): Promise<string> {
    const p: SpeechProvider = this.d.settings().sttProvider
    if (p === 'local') return this.d.local.stt.transcribe(wav)
    const r = p === 'openai' ? await openAiTranscribe(this.cloudConfig(), wav) : await geminiTranscribe(this.cloudConfig(), wav)
    void this.record(r.usage)
    return r.text
  }

  /** Status of the LOCAL services. Whether a cloud provider is usable is just "its key is present" (the renderer knows the keys). */
  async status(): Promise<{ stt: boolean; tts: boolean; ttsReady: boolean }> {
    const [ls, lt] = await Promise.all([this.d.local.stt.status(), this.d.local.tts.status()])
    return { stt: ls.up, tts: lt.up, ttsReady: lt.ready }
  }
}

export interface TestStep { name: string; ok: boolean; ms: number; detail: string }
export interface TestReport { provider: CloudProvider; steps: TestStep[]; costUsd: number }

/**
 * "Test this provider": key present -> list models (free) -> speak one sentence (played back) -> transcribe it again.
 * The two paid steps cost a fraction of a cent and are added to the usage totals like any other call.
 */
export async function selfTest(router: SpeechRouter, provider: CloudProvider, over: Parameters<SpeechRouter['cloudConfig']>[0], voice: string, play: (wav: Uint8Array) => void): Promise<TestReport> {
  const cfg = router.cloudConfig(over, provider)
  const steps: TestStep[] = []; let cost = 0
  const step = async <T>(name: string, fn: () => Promise<{ value: T; detail: string }>): Promise<T | undefined> => {
    const t0 = Date.now()
    try { const r = await fn(); steps.push({ name, ok: true, ms: Date.now() - t0, detail: r.detail }); return r.value } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - t0, detail: (err as Error).message }); return undefined
    }
  }
  if (!cfg.getKey(provider)) return { provider, steps: [{ name: 'API key', ok: false, ms: 0, detail: `Add ECHO_TERM_${provider.toUpperCase()}_API_KEY to .env and restart the app.` }], costUsd: 0 }
  steps.push({ name: 'API key', ok: true, ms: 0, detail: 'Found in .env' })
  const models = await step('Reach the API (list models)', async () => {
    const m = await listModels(cfg, provider)
    const mine = cfg[provider].ttsModel
    return { value: m, detail: `${m.tts.length} voice and ${m.stt.length} transcription models available` + (m.tts.length && !m.tts.includes(mine) ? `. Note: "${mine}" is not in the list` : '') }
  })
  if (!models) return { provider, steps, costUsd: cost }
  const sentence = 'Hello! This is a test of the cloud voice. If you can hear this, everything works.'
  const spoken = await step(`Speak a sentence (${cfg[provider].ttsModel}, voice ${voice})`, async () => {
    const r = provider === 'openai' ? await openAiSpeak(cfg, sentence, voice) : await geminiSpeak(cfg, sentence, voice)
    const c = estimateCost(r.usage); cost += c ?? 0; void router.record(r.usage)
    return { value: r.audio, detail: `${r.usage.audioSeconds?.toFixed(1)} s of audio, estimated ${c === null ? 'cost unknown' : '$' + c.toFixed(4)}` }
  })
  if (spoken) {
    play(spoken)
    await step(`Transcribe it back (${cfg[provider].sttModel})`, async () => {
      const r = provider === 'openai' ? await openAiTranscribe(cfg, spoken) : await geminiTranscribe(cfg, spoken)
      const c = estimateCost(r.usage); cost += c ?? 0; void router.record(r.usage)
      return { value: r.text, detail: `"${r.text.slice(0, 90)}", estimated ${c === null ? 'cost unknown' : '$' + c.toFixed(4)}` }
    })
  }
  return { provider, steps, costUsd: cost }
}

export { CloudError }
