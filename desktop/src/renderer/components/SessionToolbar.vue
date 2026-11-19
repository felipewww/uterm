<script setup lang="ts">
import { computed } from 'vue'
import { selected, store } from '../store'

const emit = defineEmits<{ settings: [] }>()
const s = computed(() => selected())
const hasAudio = computed(() => store.audio.speakingSessionId !== null)

async function toggleMute() { if (s.value) await window.echo.sessions.mute({ id: s.value.id, muted: !s.value.muted }) }
async function replay() { if (s.value) await window.echo.voice.replay({ id: s.value.id }) }
async function openVscode() { if (s.value) await window.echo.sessions.openInVscode({ id: s.value.id }) }
async function stopAudio() { await window.echo.voice.stopPlayback() }
async function toggleGlobalMute() { await window.echo.settings.save({ globalMute: !store.settings.globalMute }) }
</script>

<template>
  <div v-if="s" class="toolbar">
    <div class="toolbar-title">
      <strong>{{ s.title }}</strong>
      <span class="muted">{{ s.agentType === 'claude' ? 'Claude Code' : 'Codex CLI' }} · {{ s.workingDirectory }}</span>
    </div>
    <div class="toolbar-actions">
      <button class="btn" :class="{ on: s.muted }" title="Mute/unmute this session's voice" @click="toggleMute">{{ s.muted ? '🔇 Unmute' : '🔈 Mute' }}</button>
      <button class="btn" :disabled="!hasAudio" title="Stop audio (agent keeps running)" @click="stopAudio">⏹ Stop audio</button>
      <button class="btn" title="Replay last spoken message" @click="replay">↻ Replay</button>
      <button class="btn" title="Open the working directory in VS Code" @click="openVscode">VS Code</button>
      <button class="btn" :class="{ on: store.settings.globalMute }" title="Mute everything" @click="toggleGlobalMute">{{ store.settings.globalMute ? 'Global mute: on' : 'Global mute' }}</button>
      <button class="btn" title="Session voice settings" @click="emit('settings')">Voice settings</button>
      <button class="btn" :class="{ on: store.showActivity }" @click="store.showActivity = !store.showActivity">Activity</button>
    </div>
  </div>
</template>
