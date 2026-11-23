<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ON_MAC, VOICE_MODES, type AppSettings, type SpeechProvider, type TtsEngine, type VoiceMode } from '@shared/types'
import { GEMINI_VOICES, OPENAI_VOICES, cloudVoiceId, parseVoiceId } from '@shared/voices'
import { prettyShortcut, shortcutFromEvent } from '../shortcut'
import { toWav16k } from '../composables/useRecorder'
import { notify, refreshStatus, store } from '../store'
import CloudEngineConfig from './CloudEngineConfig.vue'

const props = defineProps<{ g: AppSettings; tab?: string }>()
const s = props.g // the parent's reactive settings draft: saved with its Save button

type Engine = TtsEngine | 'openai' | 'gemini'
type Tab = 'output' | 'input' | 'behavior'
const tab = ref<Tab>((['output', 'input', 'behavior'] as string[]).includes(props.tab ?? '') ? props.tab as Tab : 'output')
const modes = VOICE_MODES as readonly VoiceMode[]
const modeHelp: Record<VoiceMode, string> = {
  silent: 'No audio.', essential: 'Questions, permissions, blockers.', balanced: 'Essential + final results.', conversational: 'Balanced + progress updates.'
}
const isLinux = navigator.userAgent.includes('Linux')

/** Output is one choice. For the cloud engines it is the provider of the default voice, for the others the "local" engine. */
const out = computed<Engine>({
  get: () => { const p = parseVoiceId(s.defaultVoiceId).provider; return p === 'local' ? s.ttsEngine : p },
  set: (e) => {
    if (e === 'openai' || e === 'gemini') { if (parseVoiceId(s.defaultVoiceId).provider !== e) s.defaultVoiceId = cloudVoiceId(e, e === 'openai' ? 'coral' : 'Kore') }
    else { s.ttsEngine = e; if (parseVoiceId(s.defaultVoiceId).provider !== 'local') s.defaultVoiceId = 'default' }
  }
})
const inp = computed<SpeechProvider>({ get: () => s.sttProvider, set: (v) => { s.sttProvider = v } })

const cb = reactive<{ busy: boolean; state: '' | 'ready' | 'loading' | 'down' }>({ busy: false, state: '' })
async function testChatterbox() {
  cb.busy = true; cb.state = ''
  try { const r = await window.echo.engine.testChatterbox({ url: s.ttsUrl }) as { up: boolean; ready: boolean }; cb.state = r.up ? (r.ready ? 'ready' : 'loading') : 'down' } catch { cb.state = 'down' } finally { cb.busy = false }
}
const checking = ref(false)
async function recheckSystem() { checking.value = true; try { await refreshStatus() } finally { checking.value = false } }

interface Card { id: string; name: string; desc: string; cloud?: boolean }
const outCards: Card[] = [
  { id: 'system', name: 'System voice', desc: 'The voice built into your computer. Nothing to install or configure' },
  { id: 'chatterbox', name: 'Chatterbox server', desc: 'Natural voices and voice cloning, from a server you run yourself' },
  { id: 'gemini', name: 'Google Gemini', desc: 'Cloud voice. Needs an API key and is billed to your account', cloud: true },
  { id: 'openai', name: 'OpenAI', desc: 'Cloud voice. Needs an API key and is billed to your account', cloud: true }
]
const inCards: Card[] = [
  { id: 'local', name: 'Whisper, built into the app', desc: 'Runs on this computer. Your audio never leaves it. Nothing to configure' },
  { id: 'gemini', name: 'Google Gemini', desc: 'Cloud transcription. Your recordings are sent to Google', cloud: true },
  { id: 'openai', name: 'OpenAI', desc: 'Cloud transcription. Your recordings are sent to OpenAI', cloud: true }
]
type Tone = 'ok' | 'warn' | 'bad'
const outStatus = (id: string): { tone: Tone; text: string } => {
  if (id === 'system') return store.status.systemVoice ? { tone: 'ok', text: 'Ready' } : { tone: 'bad', text: 'Not installed' }
  if (id === 'chatterbox') return store.status.chatterbox ? { tone: 'ok', text: 'Connected' } : { tone: 'warn', text: 'Not checked' }
  return store.keys[id as 'openai' | 'gemini'] ? { tone: 'ok', text: 'Key saved' } : { tone: 'warn', text: 'Needs a key' }
}
const inStatus = (id: string): { tone: Tone; text: string } => {
  if (id === 'local') return store.status.stt ? { tone: 'ok', text: 'Ready' } : { tone: 'bad', text: 'Not available' }
  return store.keys[id as 'openai' | 'gemini'] ? { tone: 'ok', text: 'Key saved' } : { tone: 'warn', text: 'Needs a key' }
}
const tabs = computed(() => [
  { id: 'output' as Tab, label: 'Output', sub: nameOf(outCards, out.value), icon: 'M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5M12.5 3.75a6 6 0 0 1 0 8.5' },
  { id: 'input' as Tab, label: 'Input', sub: nameOf(inCards, inp.value), icon: 'M6 2.5h4a1.5 1.5 0 0 1 1.5 1.5v3a3.5 3.5 0 0 1-7 0V4A1.5 1.5 0 0 1 6 2.5zM3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2M5.75 14.25h4.5' },
  { id: 'behavior' as Tab, label: 'Behavior', sub: `${s.defaultForegroundMode} in front`, icon: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.5 3v3M10.5 6.5v3M7 10v3' }
])
const cloudId = (id: string): 'openai' | 'gemini' => (id === 'openai' ? 'openai' : 'gemini')
// --- voice of the chosen output engine
const voiceOptions = computed(() => {
  if (out.value === 'gemini') return GEMINI_VOICES.map((v) => ({ id: v.id, label: `${v.name} · ${v.trait}` }))
  if (out.value === 'openai') return OPENAI_VOICES.map((v) => ({ id: v.id, label: v.name }))
  if (out.value === 'chatterbox') return store.voices.map((v) => ({ id: v.id, label: v.name }))
  return []
})
async function previewVoice(id: string) { await window.echo.voice.preview({ voiceId: id }) }
const newVoiceName = ref('')
const voiceFile = ref<File | null>(null)
const creating = ref(false)
async function createVoice() {
  if (!voiceFile.value || !newVoiceName.value.trim()) { notify('warn', 'Choose a name and an authorized reference recording (3–30 s).'); return }
  creating.value = true
  try {
    const wav = await toWav16k(voiceFile.value).catch(async () => await voiceFile.value!.arrayBuffer())
    await window.echo.voice.create(newVoiceName.value.trim(), wav)
    store.voices = await window.echo.voice.list(); newVoiceName.value = ''; voiceFile.value = null
    notify('info', 'Voice profile created.')
  } catch (e) { notify('error', `Could not create voice: ${(e as Error).message}`) } finally { creating.value = false }
}
async function removeVoice(id: string) { await window.echo.voice.remove({ voiceId: id }); store.voices = await window.echo.voice.list() }

// --- microphone and recording shortcut (speech input)
const mics = ref<MediaDeviceInfo[]>([])
const capturing = ref(false)
onMounted(async () => {
  try { mics.value = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput') } catch { /* no permission yet */ }
  try { store.voices = await window.echo.voice.list() } catch { /* the list stays as it was */ }
})
function captureShortcut(e: KeyboardEvent) {
  const sc = shortcutFromEvent(e)
  if (sc) { s.recordShortcut = sc; capturing.value = false }
  e.preventDefault(); e.stopPropagation() // Escape here must not close the dialog
}
const nameOf = (cards: Card[], id: string) => cards.find((c) => c.id === id)?.name ?? id
</script>

<template>
  <nav class="subtabs" role="tablist" aria-label="Voice settings">
    <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab === t.id" class="subtab" :class="{ on: tab === t.id }" @click="tab = t.id">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="t.icon" /></svg><span><strong>{{ t.label }}</strong><small>{{ t.sub }}</small></span>
    </button>
  </nav>

  <template v-if="tab === 'output'">
  <p class="hint eng-hint">What you hear: the agents' replies read aloud. Choose one engine; only its settings are shown.</p>
  <div class="eng-list" role="radiogroup" aria-label="Speech output engine">
    <div v-for="c in outCards" :key="c.id" class="eng" :class="{ on: out === c.id }">
      <button class="eng-head" role="radio" :aria-checked="out === c.id" @click="out = c.id as Engine">
        <i class="eng-radio"></i>
        <span class="eng-text"><strong>{{ c.name }}</strong><small>{{ c.desc }}</small></span>
        <span class="eng-pill" :class="outStatus(c.id).tone">{{ outStatus(c.id).text }}</span>
      </button>
      <div v-if="out === c.id && c.id !== 'chatterbox' && !c.cloud" class="eng-body">
        <p v-if="store.status.systemVoice" class="hint">Ready. Speaks with the voice built into your computer.</p>
        <p v-else-if="isLinux" class="hint">Not found. Install it with <code>sudo apt install espeak-ng</code>, then check again.</p>
        <p v-else class="hint">Not available on this computer. Pick another engine.</p>
        <div class="cloud-actions"><button class="btn" :disabled="checking" @click="recheckSystem">{{ checking ? 'Checking…' : 'Check again' }}</button></div>
      </div>
      <div v-else-if="out === c.id && c.id === 'chatterbox'" class="eng-body">
        <div class="field wide">
          <div class="field-text"><strong>Server address</strong><small>The Docker server in this project (<code>docker compose up -d tts</code>) or any server with the same API</small></div>
          <div class="row key-row"><input v-model="s.ttsUrl" spellcheck="false" placeholder="http://127.0.0.1:18090" aria-label="Chatterbox server address" /><button class="btn small" :disabled="cb.busy" @click="testChatterbox">{{ cb.busy ? 'Testing…' : 'Test' }}</button></div>
        </div>
        <p v-if="cb.state" class="hint" :class="cb.state === 'ready' ? 'tone-ok' : cb.state === 'loading' ? '' : 'tone-bad'">{{ cb.state === 'ready' ? 'Connected and ready.' : cb.state === 'loading' ? 'Connected, the model is still loading.' : 'No answer at that address. The system voice is used until it responds.' }}</p>
        <p class="hint">Cloned voices are managed below, under Output, while this engine is chosen.</p>
      </div>
      <div v-else-if="out === c.id && c.cloud" class="eng-body">
        <CloudEngineConfig :g="g" :provider="cloudId(c.id)" kind="tts" />
        <p class="hint">The text of spoken replies is sent to the provider.</p>
      </div>
    </div>
  </div>

  <div class="eng-extras">
    <div v-if="voiceOptions.length" class="field wide">
      <div class="field-text"><strong>Voice</strong><small>The default for every chat. Each chat can pick its own from the speaker button</small></div>
      <div class="row key-row"><select v-model="s.defaultVoiceId" aria-label="Default voice"><option v-for="v in voiceOptions" :key="v.id" :value="v.id">{{ v.label }}</option></select><button class="btn small" :disabled="!s.defaultVoiceId" @click="previewVoice(s.defaultVoiceId)">Preview</button></div>
    </div>
    <div class="field">
      <div class="field-text"><strong>Playback speed</strong><small>0.5 – 2</small></div>
      <input v-model.number="s.defaultPlaybackSpeed" type="number" min="0.5" max="2" step="0.05" />
    </div>
    <div class="field">
      <div class="field-text"><strong>Mute all voice output</strong><small>System-wide. Also in the sidebar footer</small></div>
      <input v-model="s.globalMute" class="switch" type="checkbox" aria-label="Mute all voice output" />
    </div>
    <template v-if="out === 'chatterbox'">
      <div v-for="v in store.voices" :key="v.id" class="voice-row-item">
        <span>{{ v.name }}</span>
        <span class="row"><button class="btn small" @click="previewVoice(v.id)">Preview</button><button v-if="v.id !== 'default'" class="btn small" @click="removeVoice(v.id)">Delete</button></span>
      </div>
      <div class="add-voice">
        <input v-model="newVoiceName" placeholder="New voice name" />
        <input type="file" accept="audio/*" @change="(e) => (voiceFile = (e.target as HTMLInputElement).files?.[0] ?? null)" />
        <button class="btn" :disabled="creating" @click="createVoice">{{ creating ? 'Creating…' : 'Add voice' }}</button>
      </div>
      <p class="muted fine">Clone a voice from a short recording you are authorized to use (3–30 s). Reference clips stay on your Chatterbox server.</p>
    </template>
  </div>
</template>

  <template v-else-if="tab === 'input'">
  <p class="hint eng-hint">What you say: your recordings turned into text. Choose one engine.</p>
  <div class="eng-list" role="radiogroup" aria-label="Speech input engine">
    <div v-for="c in inCards" :key="c.id" class="eng" :class="{ on: inp === c.id }">
      <button class="eng-head" role="radio" :aria-checked="inp === c.id" @click="inp = c.id as SpeechProvider">
        <i class="eng-radio"></i>
        <span class="eng-text"><strong>{{ c.name }}</strong><small>{{ c.desc }}</small></span>
        <span class="eng-pill" :class="inStatus(c.id).tone">{{ inStatus(c.id).text }}</span>
      </button>
      <div v-if="inp === c.id && !c.cloud" class="eng-body">
        <p class="hint">{{ store.status.stt ? 'The speech model loads the first time you record.' : 'Not available on this computer (Intel Macs). Choose a cloud engine.' }}</p>
      </div>
      <div v-else-if="inp === c.id && c.cloud" class="eng-body">
        <CloudEngineConfig :g="g" :provider="cloudId(c.id)" kind="stt" />
      </div>
    </div>
  </div>
  <div class="eng-extras">
    <div class="field">
      <div class="field-text"><strong>Microphone</strong></div>
      <select v-model="s.microphoneId"><option value="">System default</option><option v-for="m in mics" :key="m.deviceId" :value="m.deviceId">{{ m.label || m.deviceId.slice(0, 8) }}</option></select>
    </div>
    <div class="field">
      <div class="field-text"><strong>Recording shortcut</strong><small>Click, then press the keys. Works while this window is focused</small></div>
      <input :value="capturing ? 'Press keys…' : prettyShortcut(s.recordShortcut, ON_MAC)" readonly @focus="capturing = true" @blur="capturing = false" @keydown="captureShortcut" />
    </div>
  </div>
  </template>

  <template v-else>
    <h3 class="pane-title first">When to speak</h3>
    <div class="field">
      <div class="field-text"><strong>Foreground mode</strong><small>Selected session, window focused</small></div>
      <select v-model="s.defaultForegroundMode"><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select>
    </div>
    <div class="field">
      <div class="field-text"><strong>Background mode</strong><small>Other sessions, or window unfocused</small></div>
      <select v-model="s.defaultBackgroundMode"><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select>
    </div>
    <p class="muted mode-help"><template v-for="m in modes" :key="m"><b>{{ m }}</b>: {{ modeHelp[m] }}{{ ' ' }}</template></p>
    <div class="field">
      <div class="field-text"><strong>Speech-friendly replies</strong><small>Ask new Claude sessions to end long replies with a short &lt;voice&gt; summary</small></div>
      <input v-model="s.injectSpeechInstructions" class="switch" type="checkbox" aria-label="Speech-friendly replies" />
    </div>
    <h3 class="pane-title">Queue</h3>
    <div class="field">
      <div class="field-text"><strong>Max spoken characters</strong><small>Longer messages are shortened</small></div>
      <input v-model.number="s.speechMaxChars" type="number" min="80" max="600" />
    </div>
    <div class="field">
      <div class="field-text"><strong>Max queued items</strong></div>
      <input v-model.number="s.queueMaxItems" type="number" min="1" max="50" />
    </div>
    <div class="field">
      <div class="field-text"><strong>Progress expires after</strong><small>Milliseconds</small></div>
      <input v-model.number="s.progressExpiryMs" type="number" min="1000" step="1000" />
    </div>
  </template>
  <p class="hint">Press <strong>Save</strong> to apply engine and model choices. API keys are saved right away.</p>
</template>
