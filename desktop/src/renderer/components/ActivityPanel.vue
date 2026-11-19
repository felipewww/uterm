<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import VoiceBar from './VoiceBar.vue'
import { ingestHistory, selected, store, type ActivityItem } from '../store'

const list = ref<HTMLElement | null>(null)
const items = computed(() => (store.selectedId ? store.activity[store.selectedId] ?? [] : []))
const op = computed(() => (store.selectedId ? store.currentOp[store.selectedId] : ''))
const icon: Record<string, string> = { prompt: '›', progress: '…', tool: '›', question: '?', permission: '!', error: '×', final: '✓', attention: '!' }
const label: Record<string, string> = { prompt: 'You', progress: 'Progress', tool: 'Tool', question: 'Question', permission: 'Permission requested', error: 'Error', final: 'Result', attention: 'Notice' }

watch(() => store.selectedId, async (id) => {
  if (id) { const rows = await window.echo.sessions.activity({ id }); ingestHistory(id, rows) }
}, { immediate: true })
watch(() => items.value.length, async () => { await nextTick(); if (list.value) list.value.scrollTop = list.value.scrollHeight })
const LISTENABLE = new Set(['progress', 'final', 'question', 'permission'])
const playing = (it: ActivityItem) => store.audio.speakingEventId === it.id
async function listen(it: ActivityItem) {
  if (!store.selectedId) return
  if (playing(it)) { await window.echo.voice.stopPlayback(); return }
  await window.echo.voice.listen({ id: store.selectedId, text: it.text, ref: it.id })
}
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <aside class="activity">
    <div class="activity-head">
      <span>Activity</span>
      <span class="muted">{{ selected()?.runtimeState.replaceAll('_', ' ').toLowerCase() }}</span>
    </div>
    <div v-if="op" class="current-op">⚙ {{ op }}</div>
    <div ref="list" class="activity-list">
      <div v-for="it in items" :key="it.id" class="act" :class="[it.kind, { spoken: it.spoken, playing: playing(it) }]">
        <div class="act-marker">{{ icon[it.kind] }}</div>
        <div class="act-body">
          <div class="act-head">
            <span class="act-label">{{ label[it.kind] }}<svg v-if="it.spoken" class="spoken-mark" viewBox="0 0 16 16" aria-label="Spoken aloud"><title>Spoken aloud</title><path d="M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5" /></svg></span>
            <span class="act-meta">
              <button v-if="LISTENABLE.has(it.kind)" class="listen-btn" :class="{ on: playing(it) }" :title="playing(it) ? 'Stop' : 'Listen'" :aria-label="playing(it) ? 'Stop audio' : 'Listen to this message'" @click="listen(it)">
                <svg v-if="!playing(it)" aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3.25v9.5L12.5 8z" /></svg>
                <svg v-else aria-hidden="true" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /></svg>
              </button>
              <span class="muted">{{ time(it.at) }}</span>
            </span>
          </div>
          <div class="act-text">{{ it.text }}</div>
        </div>
      </div>
      <div v-if="!items.length" class="empty">Structured agent activity appears here. The terminal stays the source of truth.</div>
    </div>
    <VoiceBar />
  </aside>
</template>
