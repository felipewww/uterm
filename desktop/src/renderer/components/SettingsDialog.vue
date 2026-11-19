<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { AGENT_LABELS, AGENT_TYPES, VOICE_MODES, type AgentType, type AppSettings, type VoiceMode } from '@shared/types'
import { shortcutFromEvent } from '../shortcut'
import { notify, selected, store, toggleService } from '../store'
import CloudVoicePane from './CloudVoicePane.vue'
import VoicePicker from './VoicePicker.vue'
import { cloudVoiceLabel } from '@shared/voices'
import UsagePane from './UsagePane.vue'
import { toWav16k } from '../composables/useRecorder'
import { THEMES, TERMINAL_BACKGROUNDS, currentTerminalBackground, currentTheme, setTerminalBackground, setTheme } from '../design/theme'

const props = defineProps<{ sessionId?: string | null; pane?: string }>()
const emit = defineEmits<{ close: [] }>()

const sess = computed(() => (props.sessionId ? store.sessions.find((s) => s.id === props.sessionId) : undefined))
const g = reactive<AppSettings>({ ...store.settings })
const mics = ref<MediaDeviceInfo[]>([])
const capturing = ref(false)
const newVoiceName = ref('')
const voiceFile = ref<File | null>(null)
const busy = ref(false)
/** Human name of a voice id, for "Use the default (…)". */
const voiceName = (id: string) => store.voices.find((v) => v.id === id)?.name ?? cloudVoiceLabel(id) ?? id
const dot = (n: 'stt' | 'tts') => {
  if (!store.enabled[n]) return 'off'
  if (n === 'tts') return store.status.ttsReady ? 'ok' : store.status.tts ? 'warm' : 'bad'
  return store.status.stt ? 'ok' : 'bad'
}
const text = (n: 'stt' | 'tts') => {
  if (!store.enabled[n]) return 'Off (memory freed)'
  if (n === 'tts') return store.status.ttsReady ? 'Ready' : store.status.tts ? 'Loading the model…' : 'Offline'
  return store.status.stt ? 'Ready' : 'Offline'
}

type Pane = 'general' | 'voice' | 'cloud' | 'usage' | 'input' | 'services'
const pane = ref<Pane>((['general', 'voice', 'cloud', 'usage', 'input', 'services'] as string[]).includes(props.pane ?? '') ? props.pane as Pane : 'general')
const panes: Array<{ id: Pane; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.5 3v3M10.5 6.5v3M7 10v3' },
  { id: 'voice', label: 'Voice', icon: 'M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5M12.5 3.75a6 6 0 0 1 0 8.5' },
  { id: 'cloud', label: 'Cloud voice', icon: 'M4.5 12.5h7a2.75 2.75 0 0 0 .4-5.47A3.75 3.75 0 0 0 4.7 6.2 3.15 3.15 0 0 0 4.5 12.5z' },
  { id: 'usage', label: 'Usage', icon: 'M3 13V8.5M6.5 13V4M10 13V7M13.5 13V2.5' },
  { id: 'input', label: 'Microphone', icon: 'M6 2.5h4a1.5 1.5 0 0 1 1.5 1.5v3a3.5 3.5 0 0 1-7 0V4A1.5 1.5 0 0 1 6 2.5zM3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2M5.75 14.25h4.5' },
  { id: 'services', label: 'Services', icon: 'M2.5 3.5h11v3.5h-11zM2.5 9h11v3.5h-11zM4.75 5.25h.01M4.75 10.75h.01' }
]
const modes = VOICE_MODES as readonly VoiceMode[]
const modeHelp: Record<VoiceMode, string> = {
  silent: 'No audio.', essential: 'Questions, permissions, blockers.', balanced: 'Essential + final results.', conversational: 'Balanced + progress updates.'
}

const sv = reactive({
  voiceProfileId: sess.value?.voiceProfileId ?? '',
  playbackSpeed: sess.value?.playbackSpeed ?? 0,
  foreground: sess.value?.foregroundVoiceMode ?? '',
  background: sess.value?.backgroundVoiceMode ?? '',
  coach: sess.value?.englishCoach === null || sess.value?.englishCoach === undefined ? '' : sess.value.englishCoach ? 'on' : 'off'
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
    englishCoach: sv.coach === '' ? null : sv.coach === 'on',
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
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !capturing.value) emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <!-- per-session voice settings -->
    <div v-if="sess" class="modal settings compact" role="dialog" aria-label="Session voice settings">
      <header class="settings-head">
        <div><h2>Voice settings</h2><p class="muted">{{ sess.title }} · empty values use the global defaults</p></div>
        <button class="icon-btn" aria-label="Close" @click="emit('close')"><svg class="x" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
      </header>
      <div class="settings-pane">
        <div class="field">
<div class="field-text"><strong>Voice</strong></div>
          <VoicePicker v-model="sv.voiceProfileId" :inherit="`Use the default (${voiceName(store.settings.defaultVoiceId)})`" preview-button />
</div>
        <div class="field">
          <div class="field-text"><strong>English coach</strong><small>A more natural version of what you say, shown before you send</small></div>
          <select v-model="sv.coach"><option value="">Use the global setting ({{ store.settings.englishCoach ? 'on' : 'off' }})</option><option value="on">On for this chat</option><option value="off">Off for this chat</option></select>
        </div>
        <div class="field">
<div class="field-text"><strong>Playback speed</strong></div>
          <input v-model.number="sv.playbackSpeed" type="number" min="0.5" max="2" step="0.05" placeholder="default" />
</div>
        <div class="field">
<div class="field-text"><strong>Foreground mode</strong><small>This session is selected and the window is focused</small></div>
          <select v-model="sv.foreground"><option value="">Global default ({{ store.settings.defaultForegroundMode }})</option><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select>
</div>
        <div class="field">
<div class="field-text"><strong>Background mode</strong><small>Another session is selected, or the window is unfocused</small></div>
          <select v-model="sv.background"><option value="">Global default ({{ store.settings.defaultBackgroundMode }})</option><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select>
</div>
        <p class="muted mode-help"><template v-for="m in modes" :key="m"><b>{{ m }}</b>: {{ modeHelp[m] }} </template></p>
      </div>
      <footer class="settings-foot"><button class="btn" @click="emit('close')">Cancel</button><button class="btn primary" @click="saveSession">Save</button></footer>
    </div>

    <!-- global settings -->
    <div v-else class="modal settings" role="dialog" aria-label="Settings">
      <header class="settings-head">
        <h2>Settings</h2>
        <button class="icon-btn" aria-label="Close" @click="emit('close')"><svg class="x" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
      </header>
      <div class="settings-body">
        <nav class="settings-nav" aria-label="Settings sections">
          <button v-for="p in panes" :key="p.id" class="nav-item" :class="{ active: pane === p.id }" @click="pane = p.id">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path :d="p.icon" /></svg>{{ p.label }}
          </button>
        </nav>

        <div class="settings-pane">
          <template v-if="pane === 'general'">
            <h3 class="pane-title">Appearance</h3>
            <div class="field">
<div class="field-text"><strong>Theme</strong><small>Applies immediately</small></div>
              <select :value="currentTheme" @change="setTheme(($event.target as HTMLSelectElement).value)"><option v-for="t in THEMES" :key="t.id" :value="t.id">{{ t.label }}</option></select>
</div>
            <div class="field">
<div class="field-text"><strong>Terminal background</strong><small>Applies immediately</small></div>
              <select :value="currentTerminalBackground" @change="setTerminalBackground(($event.target as HTMLSelectElement).value)"><option v-for="b in TERMINAL_BACKGROUNDS" :key="b.id" :value="b.id">{{ b.label }}</option></select>
</div>
            <h3 class="pane-title">Sessions</h3>
            <div class="field">
<div class="field-text"><strong>Default agent</strong><small>Preselected in the New session dialog</small></div>
              <select v-model="g.defaultAgent"><option v-for="t in AGENT_TYPES" :key="t" :value="t" :disabled="!!store.agents[t] && !store.agents[t]!.installed">{{ AGENT_LABELS[t].label }}{{ store.agents[t] && !store.agents[t]!.installed ? ' — not installed' : '' }}</option></select>
</div>
          </template>

          <template v-else-if="pane === 'voice'">
            <h3 class="pane-title">Output</h3>
            <div class="field">
<div class="field-text"><strong>Mute all voice output</strong><small>System-wide. Also in the sidebar footer</small></div>
              <input v-model="g.globalMute" class="switch" type="checkbox" aria-label="Mute all voice output" />
</div>
            <div class="field">
<div class="field-text"><strong>Default voice</strong><small>Used by every chat unless it picks its own. Includes cloud voices.</small></div>
              <VoicePicker v-model="g.defaultVoiceId" preview-button />
</div>
            <h3 class="pane-title">English practice</h3>
            <div class="field">
<div class="field-text"><strong>English coach</strong><small>After each recording, show a more natural B2–C1 version next to your transcription before you send. Needs the OpenAI key (Settings → Cloud voice). Each chat can override this.</small></div>
              <input v-model="g.englishCoach" class="switch" type="checkbox" aria-label="English coach" />
</div>
            <div class="field">
<div class="field-text"><strong>Playback speed</strong><small>0.5 – 2</small></div>
              <input v-model.number="g.defaultPlaybackSpeed" type="number" min="0.5" max="2" step="0.05" />
</div>
            <h3 class="pane-title">When to speak</h3>
            <div class="field">
<div class="field-text"><strong>Foreground mode</strong><small>Selected session, window focused</small></div>
              <select v-model="g.defaultForegroundMode"><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select>
</div>
            <div class="field">
<div class="field-text"><strong>Background mode</strong><small>Other sessions, or window unfocused</small></div>
              <select v-model="g.defaultBackgroundMode"><option v-for="m in modes" :key="m" :value="m">{{ m }}</option></select>
</div>
            <p class="muted mode-help"><template v-for="m in modes" :key="m"><b>{{ m }}</b>: {{ modeHelp[m] }} </template></p>
            <div class="field">
<div class="field-text"><strong>Speech-friendly replies</strong><small>Ask new Claude sessions to end long replies with a short &lt;voice&gt; summary</small></div>
              <input v-model="g.injectSpeechInstructions" class="switch" type="checkbox" aria-label="Speech-friendly replies" />
</div>
            <h3 class="pane-title">Queue</h3>
            <div class="field">
<div class="field-text"><strong>Max spoken characters</strong><small>Longer messages are shortened</small></div>
              <input v-model.number="g.speechMaxChars" type="number" min="80" max="600" />
</div>
            <div class="field">
<div class="field-text"><strong>Max queued items</strong></div>
              <input v-model.number="g.queueMaxItems" type="number" min="1" max="50" />
</div>
            <div class="field">
<div class="field-text"><strong>Progress expires after</strong><small>Milliseconds</small></div>
              <input v-model.number="g.progressExpiryMs" type="number" min="1000" step="1000" />
</div>

            <h3 class="pane-title">Voice profiles</h3>
            <div v-for="v in store.voices" :key="v.id" class="voice-row-item">
              <span>{{ v.name }}</span>
              <span class="row"><button class="btn small" @click="preview(v.id)">Preview</button><button v-if="v.id !== 'default'" class="btn small" @click="removeVoice(v.id)">Delete</button></span>
            </div>
            <div class="add-voice">
              <input v-model="newVoiceName" placeholder="New voice name" />
              <input type="file" accept="audio/*" @change="(e) => (voiceFile = (e.target as HTMLInputElement).files?.[0] ?? null)" />
              <button class="btn" :disabled="busy" @click="createVoice">{{ busy ? 'Creating…' : 'Add voice' }}</button>
            </div>
            <p class="muted fine">Only import recordings you are authorized to use (3–30 s). Reference clips stay in the local TTS volume.</p>
          </template>

          <CloudVoicePane v-else-if="pane === 'cloud'" :g="g" />
          <UsagePane v-else-if="pane === 'usage'" />

          <template v-else-if="pane === 'input'">
            <h3 class="pane-title">Voice input</h3>
            <div class="field">
<div class="field-text"><strong>Microphone</strong></div>
              <select v-model="g.microphoneId"><option value="">System default</option><option v-for="m in mics" :key="m.deviceId" :value="m.deviceId">{{ m.label || m.deviceId.slice(0, 8) }}</option></select>
</div>
            <div class="field">
<div class="field-text"><strong>Recording shortcut</strong><small>Click, then press the keys. Works while this window is focused</small></div>
              <input :value="capturing ? 'Press keys…' : g.recordShortcut" readonly @focus="capturing = true" @blur="capturing = false" @keydown="captureShortcut" />
</div>
          </template>

          <template v-else>
            <h3 class="pane-title">Status</h3>
            <div class="svc-list">
              <div class="svc-row"><i :class="store.status.db ? 'ok' : 'bad'"></i><strong>MySQL</strong><span>{{ store.status.db ? 'Connected' : 'Unavailable. History is kept in memory only' }}</span></div>
              <div class="svc-row"><i :class="dot('stt')"></i><strong>Speech-to-text</strong><span>{{ text('stt') }}</span><button class="btn small" :disabled="store.serviceBusy.stt" @click="toggleService('stt')">{{ store.serviceBusy.stt ? 'Working…' : store.enabled.stt ? 'Turn off' : 'Turn on' }}</button></div>
              <div class="svc-row"><i :class="dot('tts')"></i><strong>Text-to-speech</strong><span>{{ text('tts') }}</span><button class="btn small" :disabled="store.serviceBusy.tts" @click="toggleService('tts')">{{ store.serviceBusy.tts ? 'Working…' : store.enabled.tts ? 'Turn off' : 'Turn on' }}</button></div>
            </div>
            <p class="hint">Turning a voice service off stops its Docker container and frees its memory (about 0.7 GB for speech-to-text and 4–6 GB for text-to-speech). It stays off until you turn it on, even after restarting the app, so you can work with an agent without them running. The chips at the bottom of the sessions list do the same.</p>
            <h3 class="pane-title">Endpoints</h3>
            <div class="field"><div class="field-text"><strong>STT service URL</strong></div><input v-model="g.sttUrl" /></div>
            <div class="field"><div class="field-text"><strong>TTS service URL</strong></div><input v-model="g.ttsUrl" /></div>
            <h3 class="pane-title">Agent integration</h3>
            <div v-for="(c, name) in store.capabilities" :key="name" class="cap">
              <strong>{{ AGENT_LABELS[name as AgentType].label }}</strong>
              <ul class="notes"><li v-for="n in c.notes" :key="n">{{ n }}</li></ul>
            </div>
          </template>
        </div>
      </div>
      <footer class="settings-foot"><button class="btn" @click="emit('close')">Cancel</button><button class="btn primary" @click="saveGlobal">Save</button></footer>
    </div>
  </div>
</template>
