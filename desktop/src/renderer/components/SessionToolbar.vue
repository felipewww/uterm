<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_LABELS } from '@shared/types'
import { generatingFor, notify, selected, store } from '../store'

const emit = defineEmits<{ settings: [] }>()
const s = computed(() => selected())
const dir = computed(() => s.value?.workingDirectory.replace(/^\/home\/[^/]+/, '~') ?? '')

async function toggleMute() { if (s.value) await window.echo.sessions.mute({ id: s.value.id, muted: !s.value.muted }) }
async function openVscode() { if (s.value) await window.echo.sessions.openInVscode({ id: s.value.id }) }
async function popOut() {
  if (!s.value) return
  try { const app = await window.echo.sessions.popOut({ id: s.value.id }); notify('info', `Opened in ${app}. The session was stopped here so only one copy runs.`, 5000) }
  catch (e) { notify('error', (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000) }
}
async function stopSession() { if (s.value) await window.echo.sessions.stop({ id: s.value.id }) }
async function stopAudio() { await window.echo.voice.stopPlayback() }
</script>

<template>
  <header v-if="s" class="toolbar">
    <div class="card-title">
      <i v-if="s.agentType !== 'shell'" class="dot" :class="s.runtimeState.toLowerCase()"></i>
      <strong class="card-name" :class="{ busy: s.busy }">{{ s.title }}</strong>
      <span class="agent-tag" :class="s.agentType">{{ AGENT_LABELS[s.agentType].label }}</span>
      <span class="card-path" :title="s.workingDirectory">{{ dir }}</span>
    </div>

    <div class="toolbar-actions">
      <span v-if="store.audio.speakingSessionId" class="speaking-chip">
        <span v-if="store.audio.phase === 'generating'" class="spinner mini"></span><span v-else class="eq"><i></i><i></i><i></i></span>{{ store.audio.phase === 'generating' ? `generating voice… ${generatingFor()}s` : 'speaking' }}<template v-if="store.audio.queued"> · {{ store.audio.queued }} queued</template>
        <button class="chip-stop" title="Stop audio (the agent keeps running)" aria-label="Stop audio" @click="stopAudio"><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /></svg></button>
      </span>

      <button class="hdr-btn" :class="{ warn: s.muted }" :title="s.muted ? 'Unmute this session' : 'Mute this session'" :aria-label="s.muted ? 'Unmute this session' : 'Mute this session'" @click="toggleMute">
        <svg v-if="!s.muted" aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5" /></svg>
        <svg v-else aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 6l3 4M13.75 6l-3 4" /></svg>
      </button>
      <button class="hdr-btn" title="Voice settings for this session" aria-label="Voice settings for this session" @click="emit('settings')">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 5h5.5M12 5h1.5M2.5 11h1.5M8 11h5.5" /><circle cx="10" cy="5" r="1.75" /><circle cx="6" cy="11" r="1.75" /></svg>
      </button>
      <button class="hdr-btn" title="Open the folder in VS Code" aria-label="Open in VS Code" @click="openVscode">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5" /></svg>
      </button>

      <span class="hdr-sep"></span>

      <button class="hdr-btn" title="Open in your system terminal (stops it here and continues there)" aria-label="Open in system terminal" @click="popOut">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M9 2.75h4.25V7M13.25 2.75 7.5 8.5M11.5 9.5v2.75a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1H6.5" /></svg>
      </button>
      <button v-if="s.running" class="hdr-btn stop" title="Stop this session (ends the agent process; the conversation is kept and can be resumed)" aria-label="Stop this session" @click="stopSession">
        <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" /></svg>
      </button>

      <button class="hdr-btn" :class="{ on: store.showActivity }" :aria-pressed="store.showActivity" title="Show or hide the activity panel" aria-label="Toggle activity panel" @click="store.showActivity = !store.showActivity">
        <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M10 3v10" /></svg>
      </button>
    </div>
  </header>
</template>
