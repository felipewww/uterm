<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { selected, store } from '../store'
import { showTerminal, terminalSize } from '../terminals'

const container = ref<HTMLElement | null>(null)
const starting = ref(false)
const startError = ref('')

function show() {
  if (!container.value) return
  const s = selected()
  showTerminal(container.value, s && s.running ? s.id : null)
}

watch(() => [store.selectedId, selected()?.running], async () => { await Promise.resolve(); show() }, { flush: 'post' })
onMounted(show)

async function resume() {
  const s = selected()
  if (!s) return
  starting.value = true; startError.value = ''
  try {
    const { cols, rows } = terminalSize(s.id)
    await window.echo.sessions.start({ id: s.id, cols, rows })
  } catch (err) {
    startError.value = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  } finally { starting.value = false }
}
</script>

<template>
  <div class="terminal-wrap">
    <div ref="container" class="terminal-container"></div>
    <div v-if="selected() && !selected()!.running" class="terminal-overlay">
      <div class="overlay-card">
        <h3>{{ selected()!.title }}</h3>
        <p class="muted">This session is closed. {{ selected()!.nativeSessionId ? 'Resume continues the same conversation.' : 'No conversation was recorded yet; this will start a fresh one.' }}</p>
        <button class="btn primary" :disabled="starting" @click="resume">{{ starting ? 'Starting…' : selected()!.nativeSessionId ? 'Resume conversation' : 'Start session' }}</button>
        <p v-if="startError" class="error-text">{{ startError }}</p>
      </div>
    </div>
  </div>
</template>
