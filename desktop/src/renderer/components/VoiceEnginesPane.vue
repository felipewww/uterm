<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { type AppSettings, type SpeechProvider, type TtsEngine } from '@shared/types'
import { cloudVoiceId, parseVoiceId } from '@shared/voices'
import { refreshStatus, store } from '../store'
import ApiKeyField from './ApiKeyField.vue'

const props = defineProps<{ g: AppSettings }>()
const s = props.g // the parent's reactive settings draft: edits here are saved with its Save button

type P = 'openai' | 'gemini'
type Engine = TtsEngine | P
const providers: P[] = ['openai', 'gemini']
const name: Record<P, string> = { openai: 'OpenAI', gemini: 'Google Gemini' }
const isLinux = navigator.userAgent.includes('Linux')

/** The output engine is one choice: for the cloud ones it is the provider of the default voice, for the others the "local" engine. */
const ttsChoice = computed<Engine>({
  get: () => { const p = parseVoiceId(s.defaultVoiceId).provider; return p === 'local' ? s.ttsEngine : p },
  set: (e) => {
    if (e === 'openai' || e === 'gemini') { if (parseVoiceId(s.defaultVoiceId).provider !== e) s.defaultVoiceId = cloudVoiceId(e, e === 'openai' ? 'coral' : 'Kore') }
    else { s.ttsEngine = e; if (parseVoiceId(s.defaultVoiceId).provider !== 'local') s.defaultVoiceId = 'default' }
  }
})
const sttChoice = computed<SpeechProvider>({ get: () => s.sttProvider, set: (v) => { s.sttProvider = v } })
const keyLabel = (p: P) => (store.keys[p] ? '' : ' (add a key below)')

const cb = reactive<{ busy: boolean; state: '' | 'ready' | 'loading' | 'down' }>({ busy: false, state: '' })
async function testChatterbox() {
  cb.busy = true; cb.state = ''
  try { const r = await window.echo.engine.testChatterbox({ url: s.ttsUrl }) as { up: boolean; ready: boolean }; cb.state = r.up ? (r.ready ? 'ready' : 'loading') : 'down' } catch { cb.state = 'down' } finally { cb.busy = false }
}
const checking = ref(false)
async function recheckSystem() { checking.value = true; try { await refreshStatus() } finally { checking.value = false } }

const models = reactive<Record<P, { tts: string[]; stt: string[] }>>({ openai: { tts: [], stt: [] }, gemini: { tts: [], stt: [] } })
const busy = reactive<Record<P, string>>({ openai: '', gemini: '' })
const note = reactive<Record<P, string>>({ openai: '', gemini: '' })
interface Step { name: string; ok: boolean; ms: number; detail: string }
const report = reactive<Record<P, { steps: Step[]; costUsd: number } | null>>({ openai: null, gemini: null })
const field = (p: P, k: 'Tts' | 'Stt') => (p === 'openai' ? (k === 'Tts' ? 'openaiTtsModel' : 'openaiSttModel') : (k === 'Tts' ? 'geminiTtsModel' : 'geminiSttModel')) as keyof AppSettings
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

async function refresh(p: P) {
  busy[p] = 'models'; note[p] = ''
  try {
    models[p] = await window.echo.cloud.models({ provider: p })
    note[p] = `${models[p].tts.length} voice and ${models[p].stt.length} transcription models found. Pick from the lists below.`
  } catch (e) { note[p] = clean(e) } finally { busy[p] = '' }
}
const testVoice = (p: P) => { const v = parseVoiceId(s.defaultVoiceId); return v.provider === p ? v.voice : p === 'openai' ? 'coral' : 'Kore' }
async function test(p: P) {
  busy[p] = 'test'; report[p] = null; note[p] = ''
  try {
    report[p] = await window.echo.cloud.test({ provider: p, ttsModel: String(s[field(p, 'Tts')]), voice: testVoice(p), sttModel: String(s[field(p, 'Stt')]), style: s.cloudVoiceStyle }) as { steps: Step[]; costUsd: number }
  } catch (e) { note[p] = clean(e) } finally { busy[p] = '' }
}
</script>

<template>
  <h3 class="pane-title">Speech output</h3>
  <div class="field">
    <div class="field-text"><strong>Voice engine</strong><small>What speaks the agents' replies. Each chat can still pick its own voice from the speaker button</small></div>
    <select v-model="ttsChoice" aria-label="Voice engine">
      <option value="system">System voice</option>
      <option value="chatterbox">Chatterbox server</option>
      <option value="gemini">Google Gemini (cloud){{ keyLabel('gemini') }}</option>
      <option value="openai">OpenAI (cloud){{ keyLabel('openai') }}</option>
    </select>
  </div>
  <div v-if="ttsChoice === 'system'" class="svc-row">
    <i :class="store.status.systemVoice ? 'ok' : 'bad'"></i><strong>System voice</strong>
    <span v-if="store.status.systemVoice">Ready. Uses the voice built into your computer; nothing to install.</span>
    <span v-else-if="isLinux">Not found. Install it with <code>sudo apt install espeak-ng</code>, then check again.</span>
    <span v-else>Not available on this computer. Pick another engine.</span>
    <button class="btn small" :disabled="checking" @click="recheckSystem">{{ checking ? 'Checking…' : 'Check again' }}</button>
  </div>
  <template v-if="ttsChoice === 'chatterbox'">
    <div class="field wide">
      <div class="field-text"><strong>Server address</strong><small>A Chatterbox server you run yourself: the Docker one in this project (<code>docker compose up -d tts</code>) or any server with the same API</small></div>
      <div class="row key-row"><input v-model="s.ttsUrl" spellcheck="false" placeholder="http://127.0.0.1:18090" aria-label="Chatterbox server address" /><button class="btn small" :disabled="cb.busy" @click="testChatterbox">{{ cb.busy ? 'Testing…' : 'Test' }}</button></div>
    </div>
    <div v-if="cb.state" class="svc-row">
      <i :class="cb.state === 'ready' ? 'ok' : cb.state === 'loading' ? 'warm' : 'bad'"></i><strong>Chatterbox</strong>
      <span>{{ cb.state === 'ready' ? 'Connected and ready.' : cb.state === 'loading' ? 'Connected, the model is still loading.' : 'No answer at that address. The system voice is used until it responds.' }}</span><span></span>
    </div>
    <p class="hint">With this engine you can also clone voices (Voice → Voice profiles). The address is saved with <strong>Save</strong>.</p>
  </template>
  <p v-if="ttsChoice === 'gemini' || ttsChoice === 'openai'" class="hint">Cloud voices are billed to your account and the text of spoken replies is sent to the provider. Add the key and choose the voice models in the section for that provider below.</p>

  <h3 class="pane-title">Speech input</h3>
  <div class="field">
    <div class="field-text"><strong>Transcription engine</strong><small>Who turns your recordings into text</small></div>
    <select v-model="sttChoice" aria-label="Transcription engine">
      <option value="local">Whisper, built into the app</option>
      <option value="gemini">Google Gemini (cloud){{ keyLabel('gemini') }}</option>
      <option value="openai">OpenAI (cloud){{ keyLabel('openai') }}</option>
    </select>
  </div>
  <div v-if="sttChoice === 'local'" class="svc-row">
    <i :class="store.status.stt ? 'ok' : 'bad'"></i><strong>Whisper</strong>
    <span>{{ store.status.stt ? 'Runs on this computer: your audio never leaves it. The model loads the first time you record.' : 'Not available on this computer (Intel Macs). Choose a cloud engine.' }}</span><span></span>
  </div>
  <p v-else class="hint">Your recorded audio is sent to {{ sttChoice === 'openai' ? 'OpenAI' : 'Google' }} for each transcription.</p>

  <h3 class="pane-title">Cloud style</h3>
  <div class="field">
    <div class="field-text"><strong>Voice style</strong><small>How cloud voices are asked to sound</small></div>
    <input v-model="s.cloudVoiceStyle" maxlength="200" />
  </div>

  <template v-for="p in providers" :key="p">
    <h3 class="pane-title">{{ name[p] }}</h3>
    <ApiKeyField :provider="p" />
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
  <p class="hint">Press <strong>Save</strong> to apply the engine and model choices. Keys are saved right away.</p>
</template>
