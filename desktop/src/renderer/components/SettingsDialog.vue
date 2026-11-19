<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { VOICE_MODES, type AppSettings, type VoiceMode } from '@shared/types'
import { shortcutFromEvent } from '../shortcut'
import { notify, selected, store } from '../store'
import { toWav16k } from '../composables/useRecorder'
import { THEMES, currentTheme, setTheme } from '../design/theme'

const props = defineProps<{ sessionId?: string | null }>()
const emit = defineEmits<{ close: [] }>()

const sess = computed(() => (props.sessionId ? store.sessions.find((s) => s.id === props.sessionId) : undefined))
const g = reactive<AppSettings>({ ...store.settings })
const mics = ref<MediaDeviceInfo[]>([])
const capturing = ref(false)
const newVoiceName = ref('')
const voiceFile = ref<File | null>(null)
const busy = ref(false)
const modes = VOICE_MODES as readonly VoiceMode[]
const modeHelp: Record<VoiceMode, string> = {
  silent: 'No audio.', essential: 'Questions, permissions, blockers.', balanced: 'Essential + final results.', conversational: 'Balanced + progress updates.'
}

const sv = reactive({
  voiceProfileId: sess.value?.voiceProfileId ?? '',
  playbackSpeed: sess.value?.playbackSpeed ?? 0,
  foreground: sess.value?.foregroundVoiceMode ?? '',
  background: sess.value?.backgroundVoiceMode ?? ''
})

onMounted(async () => {
  try { mics.value = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput') } catch { /* no permission yet */ }
  store.voices = await window.echo.voice.list()
})

async function saveGlobal() {
  await window.echo.settings.save({ ...g })
  Object.assign(store.settings, g)
  notify('info', 'Settings saved.', 2500); emit('close')
}
async function saveSession() {
  if (!sess.value) return
  await window.echo.sessions.update({ id: sess.value.id, patch: {
    voiceProfileId: sv.voiceProfileId || null,
    playbackSpeed: sv.playbackSpeed ? Number(sv.playbackSpeed) : null,
    foregroundVoiceMode: sv.foreground || null, backgroundVoiceMode: sv.background || null
  } })
  emit('close')
}
function captureShortcut(e: KeyboardEvent) {
  const s = shortcutFromEvent(e)
  if (s) { g.recordShortcut = s; capturing.value = false }
  e.preventDefault()
}
async function createVoice() {
  if (!voiceFile.value || !newVoiceName.value.trim()) { notify('warn', 'Choose a name and an authorized reference recording (3–30 s).'); return }
  busy.value = true
  try {
    const wav = await toWav16k(voiceFile.value).catch(async () => await voiceFile.value!.arrayBuffer())
    await window.echo.voice.create(newVoiceName.value.trim(), wav)
    store.voices = await window.echo.voice.list(); newVoiceName.value = ''; voiceFile.value = null
    notify('info', 'Voice profile created.')
  } catch (e) { notify('error', `Could not create voice: ${(e as Error).message}`) } finally { busy.value = false }
}
async function removeVoice(id: string) { await window.echo.voice.remove({ voiceId: id }); store.voices = await window.echo.voice.list() }
async function preview(id: string) { await window.echo.voice.preview({ voiceId: id }) }
void selected
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal wide">
      <template v-if="sess">
        <h2>Voice settings · {{ sess.title }}</h2>
        <p class="muted">Empty values fall back to the global defaults.</p>
        <label>Voice
          <div class="row">
            <select v-model="sv.voiceProfileId"><option value="">Global default</option><option v-for="v in store.voices" :key="v.id" :value="v.id">{{ v.name }}</option></select>
            <button class="btn" :disabled="!sv.voiceProfileId" @click="preview(sv.voiceProfileId)">Preview</button>
          </div>
        </label>
        <label>Playback speed <input v-model.number="sv.playbackSpeed" type="number" min="0.5" max="2" step="0.05" placeholder="default" /></label>
        <label>Foreground mode (this session is selected and the window is focused)
          <select v-model="sv.foreground"><option value="">Global default ({{ store.settings.defaultForegroundMode }})</option><option v-for="m in modes" :key="m" :value="m">{{ m }} — {{ modeHelp[m] }}</option></select>
        </label>
        <label>Background mode (other sessions, or the window is unfocused)
          <select v-model="sv.background"><option value="">Global default ({{ store.settings.defaultBackgroundMode }})</option><option v-for="m in modes" :key="m" :value="m">{{ m }} — {{ modeHelp[m] }}</option></select>
        </label>
        <div class="modal-actions"><button class="btn" @click="emit('close')">Cancel</button><button class="btn primary" @click="saveSession">Save</button></div>
      </template>

      <template v-else>
        <h2>Settings</h2>
        <div class="grid2">
          <label>Theme <select :value="currentTheme" @change="setTheme(($event.target as HTMLSelectElement).value)"><option v-for="t in THEMES" :key="t.id" :value="t.id">{{ t.label }}</option></select></label>
          <label>Default agent <select v-model="g.defaultAgent"><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select></label>
          <label>Default voice <select v-model="g.defaultVoiceId"><option v-for="v in store.voices" :key="v.id" :value="v.id">{{ v.name }}</option></select></label>
          <label>Default foreground mode <select v-model="g.defaultForegroundMode"><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select></label>
          <label>Default background mode <select v-model="g.defaultBackgroundMode"><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select></label>
          <label>Playback speed <input v-model.number="g.defaultPlaybackSpeed" type="number" min="0.5" max="2" step="0.05" /></label>
          <label>Microphone
            <select v-model="g.microphoneId"><option value="">System default</option><option v-for="m in mics" :key="m.deviceId" :value="m.deviceId">{{ m.label || m.deviceId.slice(0, 8) }}</option></select>
          </label>
          <label>Recording shortcut
            <input :value="capturing ? 'Press keys…' : g.recordShortcut" readonly @focus="capturing = true" @blur="capturing = false" @keydown="captureShortcut" />
          </label>
          <label>STT service URL <input v-model="g.sttUrl" /></label>
          <label>TTS service URL <input v-model="g.ttsUrl" /></label>
          <label>Max queued audio items <input v-model.number="g.queueMaxItems" type="number" min="1" max="50" /></label>
          <label>Progress expires after (ms) <input v-model.number="g.progressExpiryMs" type="number" min="1000" step="1000" /></label>
          <label>Max spoken characters <input v-model.number="g.speechMaxChars" type="number" min="80" max="600" /></label>
          <label class="check inline"><input v-model="g.globalMute" type="checkbox" /> Global mute</label>
          <label class="check inline"><input v-model="g.injectSpeechInstructions" type="checkbox" /> Ask new Claude sessions for speech-friendly replies (&lt;voice&gt; summaries)</label>
        </div>

        <h3>Voice profiles</h3>
        <div v-for="v in store.voices" :key="v.id" class="voice-row-item">
          <span>{{ v.name }}</span>
          <span><button class="btn small" @click="preview(v.id)">Preview</button> <button v-if="v.id !== 'default'" class="btn small" @click="removeVoice(v.id)">Delete</button></span>
        </div>
        <div class="row">
          <input v-model="newVoiceName" placeholder="New voice name" />
          <input type="file" accept="audio/*" @change="(e) => (voiceFile = (e.target as HTMLInputElement).files?.[0] ?? null)" />
          <button class="btn" :disabled="busy" @click="createVoice">{{ busy ? 'Creating…' : 'Add voice' }}</button>
        </div>
        <p class="muted">Only import recordings you are authorized to use. Reference clips stay in the local TTS volume.</p>

        <h3>Services</h3>
        <p class="muted">MySQL: {{ store.status.db ? 'connected' : 'unavailable' }} · STT: {{ store.status.stt ? 'up' : 'down' }} · TTS: {{ store.status.ttsReady ? 'ready' : store.status.tts ? 'loading model…' : 'down' }}</p>
        <div v-for="(c, name) in store.capabilities" :key="name">
          <strong>{{ name === 'claude' ? 'Claude Code' : 'Codex CLI' }}</strong>
          <ul class="notes"><li v-for="n in c.notes" :key="n">{{ n }}</li></ul>
        </div>
        <div class="modal-actions"><button class="btn" @click="emit('close')">Cancel</button><button class="btn primary" @click="saveGlobal">Save</button></div>
      </template>
    </div>
  </div>
</template>
