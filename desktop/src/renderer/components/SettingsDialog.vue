<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { AGENT_LABELS, CODING_AGENTS, VOICE_MODES, type AgentType, type AppSettings, type VoiceMode } from '@shared/types'
import { notify, selected, store } from '../store'
import VoicePane from './VoicePane.vue'
import ApiKeyField from './ApiKeyField.vue'
import { playChime, playRecordingCue } from '../chime'
import VoicePicker from './VoicePicker.vue'
import { cloudVoiceLabel } from '@shared/voices'
import UsagePane from './UsagePane.vue'
import ColorsPane from './ColorsPane.vue'
import { THEMES, TERMINAL_BACKGROUNDS, currentTerminalBackground, currentTheme, setTerminalBackground, setTheme } from '../design/theme'

const props = defineProps<{ sessionId?: string | null; startPane?: string }>()
const emit = defineEmits<{ close: [] }>()

const sess = computed(() => (props.sessionId ? store.sessions.find((s) => s.id === props.sessionId) : undefined))
const g = reactive<AppSettings>({ ...store.settings })
/** Human name of a voice id, for "Use the default (…)". */
const voiceName = (id: string) => store.voices.find((v) => v.id === id)?.name ?? cloudVoiceLabel(id) ?? id
type Pane = 'general' | 'colors' | 'voice' | 'english' | 'usage' | 'system'
// "voice.input" opens the Voice pane on its Input tab
const [wantedPane, wantedTab] = (props.startPane ?? '').split('.')
const pane = ref<Pane>((['general', 'colors', 'voice', 'english', 'usage', 'system'] as string[]).includes(wantedPane ?? '') ? wantedPane as Pane : 'general')
const voiceTab = ref(wantedTab ?? 'output')
const panes: Array<{ id: Pane; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11M5.5 3v3M10.5 6.5v3M7 10v3' },
  { id: 'colors', label: 'Colors', icon: 'M8 2a6 6 0 1 0 0 12c.9 0 1.4-.6 1.4-1.3 0-.9-.8-1.1-.8-1.9 0-.7.6-1.2 1.4-1.2h1.6c1.4 0 2.4-1 2.4-2.4C14 4.2 11.3 2 8 2zM5 7.5h.01M7 5h.01M10 5h.01' },
  { id: 'voice', label: 'Voice', icon: 'M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5M12.5 3.75a6 6 0 0 1 0 8.5' },
  { id: 'english', label: 'English coach', icon: 'M2.5 4h6M5.5 4v1.5M3.5 9c1.6-.6 3-1.9 3.6-3.5M4.5 7.2c.7 1.4 1.9 2.4 3.3 2.9M9 13l2.5-6 2.5 6M9.8 11.2h3.4' },
  { id: 'usage', label: 'Usage', icon: 'M3 13V8.5M6.5 13V4M10 13V7M13.5 13V2.5' },
  { id: 'system', label: 'System', icon: 'M2.5 3.5h11v3.5h-11zM2.5 9h11v3.5h-11zM4.75 5.25h.01M4.75 10.75h.01' }
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
void selected
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
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
        <p class="muted mode-help"><template v-for="m in modes" :key="m"><b>{{ m }}</b>: {{ modeHelp[m] }}{{ ' ' }}</template></p>
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
            <h3 class="pane-title">System terminal</h3>
            <div class="field">
              <div class="field-text"><strong>Terminal app</strong><small>Used by “Open in system terminal”. Auto picks the first one installed</small></div>
              <select v-model="g.externalTerminal"><option v-for="t in ['auto', 'ptyxis', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'x-terminal-emulator']" :key="t" :value="t">{{ t }}</option></select>
            </div>
            <h3 class="pane-title">Notifications</h3>
            <div class="field">
<div class="field-text"><strong>Play a sound</strong><small>When an agent needs you or finishes while you are looking elsewhere. Silent for the session in front, while recording, and when muted</small></div>
              <input v-model="g.notifySounds" class="switch" type="checkbox" aria-label="Notification sounds" />
</div>
            <div class="field" :class="{ dim: !g.notifySounds }">
<div class="field-text"><strong>When it needs me</strong><small>A question, an approval, a blocking error. Two rising notes</small></div>
              <div class="row"><input v-model="g.notifyOnAttention" class="switch" type="checkbox" aria-label="Sound when an agent needs me" :disabled="!g.notifySounds" /><button class="btn small" :disabled="!g.notifySounds" @click="playChime('attention', g.notifyVolume)">Play</button></div>
</div>
            <div class="field" :class="{ dim: !g.notifySounds }">
<div class="field-text"><strong>When it finishes</strong><small>A task is done. One soft pop</small></div>
              <div class="row"><input v-model="g.notifyOnDone" class="switch" type="checkbox" aria-label="Sound when an agent finishes" :disabled="!g.notifySounds" /><button class="btn small" :disabled="!g.notifySounds" @click="playChime('done', g.notifyVolume)">Play</button></div>
</div>
            <div class="field">
<div class="field-text"><strong>Recording cue</strong><small>A short sound when a recording starts and when it stops</small></div>
              <div class="row"><input v-model="g.recordCues" class="switch" type="checkbox" aria-label="Recording cue" /><button class="btn small" :disabled="!g.recordCues" @click="playRecordingCue(g.notifyVolume)">Play</button></div>
</div>
            <div class="field" :class="{ dim: !g.notifySounds && !g.recordCues }">
<div class="field-text"><strong>Volume</strong></div>
              <input v-model.number="g.notifyVolume" type="range" min="0" max="1" step="0.05" :disabled="!g.notifySounds && !g.recordCues" aria-label="Notification volume" />
</div>
            <h3 class="pane-title">Sessions</h3>
            <div class="field">
<div class="field-text"><strong>Default agent</strong><small>Preselected in the New session dialog</small></div>
              <select v-model="g.defaultAgent"><option v-for="t in CODING_AGENTS" :key="t" :value="t" :disabled="!!store.agents[t] && !store.agents[t]!.installed">{{ AGENT_LABELS[t].label }}{{ store.agents[t] && !store.agents[t]!.installed ? ' — not installed' : '' }}</option></select>
</div>
          </template>

          <ColorsPane v-else-if="pane === 'colors'" />

          <VoicePane v-else-if="pane === 'voice'" :key="voiceTab" :g="g" :tab="voiceTab" />

          <template v-else-if="pane === 'english'">
            <h3 class="pane-title">English coach</h3>
            <p class="hint">Practise English while you work. For what you say or type, the coach writes a more natural version at a <strong>B2–C1</strong> level (same meaning, no forced vocabulary) and shows it next to your text. It never changes what is sent to the agent or what is spoken back.</p>
            <div class="field">
              <div class="field-text"><strong>Turn the English coach on</strong><small>Global switch. Each chat can override it in its voice settings (the speaker button in the chat header)</small></div>
              <input v-model="g.englishCoach" class="switch" type="checkbox" aria-label="English coach" />
            </div>
            <div class="field">
              <div class="field-text"><strong>Model</strong><small>A small, cheap OpenAI text model</small></div>
              <input v-model="g.englishCoachModel" spellcheck="false" />
            </div>
            <ApiKeyField provider="openai" hint="The same OpenAI key used for cloud voices. Stored encrypted on this computer" />
            <h3 class="pane-title">How it shows up</h3>
            <ul class="notes"><li><strong>Voice messages:</strong> after you record, the box shows your transcription and the natural version below it. “Use this version” swaps it in, “Back to mine” restores yours, “Redo” regenerates. Nothing is sent until you press Send.</li><li><strong>Typed messages:</strong> sent as usual from the terminal; the natural version appears under your message in the Activity panel, with no approval step.</li><li><strong>History:</strong> every pair is saved locally for later review.</li></ul>
            <p class="hint warn-note">This sends what you say or type to OpenAI. It is off by default, and its estimated cost appears under Usage. Press <strong>Save</strong> to apply.</p>
          </template>
          <UsagePane v-else-if="pane === 'usage'" />

          <template v-else>
            <h3 class="pane-title">Status</h3>
            <div class="svc-list">
              <div class="svc-row"><i :class="store.status.db ? 'ok' : 'bad'"></i><strong>Local database</strong><span>{{ store.status.db ? 'Sessions, activity and settings are saved on this computer (SQLite)' : 'Could not be opened. History is kept in memory only' }}</span><span></span></div>
              <div class="svc-row"><i :class="store.status.stt ? 'ok' : 'bad'"></i><strong>Speech-to-text</strong><span>{{ store.settings.sttProvider === 'local' ? (store.status.stt ? 'Whisper, built into the app' : 'Not available on this computer') : 'Cloud: ' + store.settings.sttProvider }}</span><button class="btn small" @click="voiceTab = 'input'; pane = 'voice'">Choose engine</button></div>
              <div class="svc-row"><i :class="store.status.tts ? 'ok' : 'bad'"></i><strong>Text-to-speech</strong><span>{{ store.settings.ttsEngine === 'chatterbox' ? 'Chatterbox server' : 'System voice' }}{{ store.status.tts ? '' : ' (unavailable)' }}</span><button class="btn small" @click="voiceTab = 'output'; pane = 'voice'">Choose engine</button></div>
            </div>
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
