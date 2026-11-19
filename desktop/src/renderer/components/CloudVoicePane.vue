<script setup lang="ts">
import { reactive } from 'vue'
import { SPEECH_PROVIDERS, type AppSettings, type SpeechProvider } from '@shared/types'
import { parseVoiceId } from '@shared/voices'
import { store, toggleService } from '../store'

const props = defineProps<{ g: AppSettings }>()
const s = props.g // the parent's reactive settings draft: edits here are saved with its Save button

const LABEL: Record<SpeechProvider, string> = { local: 'Local (Docker, on this machine)', openai: 'OpenAI (cloud)', gemini: 'Google Gemini (cloud)' }
type P = 'openai' | 'gemini'
const providers: P[] = ['openai', 'gemini']
const name: Record<P, string> = { openai: 'OpenAI', gemini: 'Google Gemini' }
const envVar: Record<P, string> = { openai: 'ECHO_TERM_OPENAI_API_KEY', gemini: 'ECHO_TERM_GEMINI_API_KEY' }
const models = reactive<Record<P, { tts: string[]; stt: string[] }>>({ openai: { tts: [], stt: [] }, gemini: { tts: [], stt: [] } })
const busy = reactive<Record<P, string>>({ openai: '', gemini: '' })
const note = reactive<Record<P, string>>({ openai: '', gemini: '' })
interface Step { name: string; ok: boolean; ms: number; detail: string }
const report = reactive<Record<P, { steps: Step[]; costUsd: number } | null>>({ openai: null, gemini: null })

const field = (p: P, k: 'Tts' | 'Stt') => (p === 'openai' ? (k === 'Tts' ? 'openaiTtsModel' : 'openaiSttModel') : (k === 'Tts' ? 'geminiTtsModel' : 'geminiSttModel')) as keyof AppSettings
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
// The voices in use decide the TTS provider; the STT provider is a setting. "Local still running" = nothing needs it but it holds memory.
const defaultIsCloud = () => parseVoiceId(props.g.defaultVoiceId).provider !== 'local'
const anySessionLocal = () => store.sessions.some((x) => !x.archivedAt && parseVoiceId(x.voiceProfileId || props.g.defaultVoiceId).provider === 'local')
const localTtsIdle = () => store.enabled.tts && defaultIsCloud() && !anySessionLocal()
const localSttIdle = () => store.enabled.stt && props.g.sttProvider !== 'local'

async function refresh(p: P) {
  busy[p] = 'models'; note[p] = ''
  try {
    models[p] = await window.echo.cloud.models({ provider: p })
    note[p] = `${models[p].tts.length} voice and ${models[p].stt.length} transcription models found. Pick from the lists below.`
  } catch (e) { note[p] = clean(e) } finally { busy[p] = '' }
}
/** The default voice when it belongs to this provider, otherwise a sensible one. */
const testVoice = (p: P) => { const v = parseVoiceId(props.g.defaultVoiceId); return v.provider === p ? v.voice : p === 'openai' ? 'coral' : 'Kore' }
async function test(p: P) {
  busy[p] = 'test'; report[p] = null; note[p] = ''
  try {
    report[p] = await window.echo.cloud.test({
      provider: p, ttsModel: String(props.g[field(p, 'Tts')]), voice: testVoice(p), sttModel: String(props.g[field(p, 'Stt')]), style: props.g.cloudVoiceStyle
    }) as { steps: Step[]; costUsd: number }
  } catch (e) { note[p] = clean(e) } finally { busy[p] = '' }
}
</script>

<template>
  <h3 class="pane-title">Cloud providers</h3>
  <p class="hint warn-note">Cloud voices are optional and billed to your account. When a chat speaks with a cloud voice, the text of its spoken replies is sent to that provider; when transcription uses a cloud provider, your recorded audio is. Keys are read from <code>.env</code> and are never stored in the database or given to the agents. Everything stays local unless you pick a cloud voice.</p>
  <div class="field">
    <div class="field-text"><strong>How to use a cloud voice</strong><small>Pick it like any other voice</small></div>
    <span class="muted">Settings → Voice → Default voice, or per chat from the speaker button in its header.</span>
  </div>
  <div class="field">
    <div class="field-text"><strong>Voice input (speech-to-text)</strong><small>Who transcribes your recordings (global)</small></div>
    <select v-model="s.sttProvider"><option v-for="p in SPEECH_PROVIDERS" :key="p" :value="p">{{ LABEL[p] }}</option></select>
  </div>
  <p v-if="localTtsIdle()" class="hint">
Every chat uses a cloud voice, so the local text-to-speech service is idle but still holds memory.
    <button class="btn small" :disabled="store.serviceBusy.tts" @click="toggleService('tts')">Turn local text-to-speech off</button>
</p>
  <p v-if="localSttIdle()" class="hint">
Transcription uses the cloud, so the local speech-to-text service is idle but still holds memory.
    <button class="btn small" :disabled="store.serviceBusy.stt" @click="toggleService('stt')">Turn local speech-to-text off</button>
</p>
  <div class="field">
    <div class="field-text"><strong>Cloud voice style</strong><small>How cloud voices are asked to sound</small></div>
    <input v-model="s.cloudVoiceStyle" maxlength="200" />
  </div>

  <h3 class="pane-title">English coach (OpenAI)</h3>
  <div class="field">
    <div class="field-text"><strong>Show a more natural version of what I say</strong><small>After each recording, next to the transcription and before sending. Level B2–C1, same meaning. It does not change what is sent or what is spoken back. Needs the OpenAI key.</small></div>
    <input v-model="s.englishCoach" class="switch" type="checkbox" aria-label="English coach" />
  </div>
  <div class="field">
    <div class="field-text"><strong>Coach model</strong><small>A small, cheap text model</small></div>
    <input v-model="s.englishCoachModel" spellcheck="false" />
  </div>

  <template v-for="p in providers" :key="p">
    <h3 class="pane-title">{{ name[p] }}</h3>
    <div class="svc-row cloud-key">
      <i :class="store.keys[p] ? 'ok' : 'bad'"></i><strong>API key</strong>
      <span>{{ store.keys[p] ? 'Found in .env' : `Missing. Add ${envVar[p]}=… to .env and restart the app` }}</span><span></span>
    </div>
    <div class="field">
      <div class="field-text"><strong>Voice model</strong><small>Text to speech</small></div>
      <input v-model="(s as any)[field(p, 'Tts')]" :list="`${p}-tts-models`" spellcheck="false" />
      <datalist :id="`${p}-tts-models`"><option v-for="m in models[p].tts" :key="m" :value="m" /></datalist>
    </div>
    <div class="field">
      <div class="field-text"><strong>Transcription model</strong><small>Speech to text</small></div>
      <input v-model="(s as any)[field(p, 'Stt')]" :list="`${p}-stt-models`" spellcheck="false" />
      <datalist :id="`${p}-stt-models`"><option v-for="m in models[p].stt" :key="m" :value="m" /></datalist>
    </div>
    <div class="cloud-actions">
      <button class="btn" :disabled="!store.keys[p] || !!busy[p]" @click="refresh(p)">{{ busy[p] === 'models' ? 'Checking…' : 'Refresh model lists' }}</button>
      <button class="btn primary" :disabled="!store.keys[p] || !!busy[p]" title="Speaks one sentence and transcribes it back. Costs a fraction of a cent." @click="test(p)">{{ busy[p] === 'test' ? 'Testing…' : `Test ${name[p]}` }}</button>
    </div>
    <p v-if="note[p]" class="hint">{{ note[p] }}</p>
    <ul v-if="report[p]" class="test-steps">
      <li v-for="st in report[p]!.steps" :key="st.name" :class="st.ok ? 'ok' : 'bad'"><i></i><div><strong>{{ st.name }}</strong><span v-if="st.ms" class="ms">{{ (st.ms / 1000).toFixed(1) }}s</span><small>{{ st.detail }}</small></div></li>
      <li class="total"><div><small>Estimated cost of this test: ${{ report[p]!.costUsd.toFixed(4) }}</small></div></li>
    </ul>
  </template>
  <p class="hint">Press <strong>Save</strong> to apply changes. The Test buttons use what you typed here right away.</p>
</template>
