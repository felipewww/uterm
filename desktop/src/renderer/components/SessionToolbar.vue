<script setup lang="ts">
import { computed } from 'vue'
import { selected, store } from '../store'

const emit = defineEmits<{ settings: [] }>()
const s = computed(() => selected())
const dir = computed(() => s.value?.workingDirectory.replace(/^\/home\/[^/]+/, '~') ?? '')

async function toggleMute() { if (s.value) await window.echo.sessions.mute({ id: s.value.id, muted: !s.value.muted }) }
async function openVscode() { if (s.value) await window.echo.sessions.openInVscode({ id: s.value.id }) }
async function stopAudio() { await window.echo.voice.stopPlayback() }
</script>

<template>
  <header v-if="s" class="toolbar">
    <div class="card-title">
      <i class="dot" :class="s.runtimeState.toLowerCase()"></i>
      <strong class="card-name">{{ s.title }}</strong>
      <span class="agent-tag" :class="s.agentType">{{ s.agentType === 'claude' ? 'Claude Code' : 'Codex CLI' }}</span>
      <span class="card-path" :title="s.workingDirectory">{{ dir }}</span>
    </div>

    <div class="toolbar-actions">
      <span v-if="store.audio.speakingSessionId" class="speaking-chip">
        <span class="eq"><i></i><i></i><i></i></span>speaking<template v-if="store.audio.queued"> · {{ store.audio.queued }} queued</template>
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

      <button class="hdr-btn" :class="{ on: store.showActivity }" :aria-pressed="store.showActivity" title="Show or hide the activity panel" aria-label="Toggle activity panel" @click="store.showActivity = !store.showActivity">
        <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M10 3v10" /></svg>
      </button>
    </div>
  </header>
</template>
