<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import VoiceBar from './VoiceBar.vue'
import { ingestHistory, selected, store } from '../store'

const list = ref<HTMLElement | null>(null)
const items = computed(() => (store.selectedId ? store.activity[store.selectedId] ?? [] : []))
const op = computed(() => (store.selectedId ? store.currentOp[store.selectedId] : ''))
const icon: Record<string, string> = { prompt: '›', progress: '…', tool: '›', question: '?', permission: '!', error: '×', final: '✓', attention: '!' }
const label: Record<string, string> = { prompt: 'You', progress: 'Progress', tool: 'Tool', question: 'Question', permission: 'Permission requested', error: 'Error', final: 'Result', attention: 'Notice' }

watch(() => store.selectedId, async (id) => {
  if (id) { const rows = await window.echo.sessions.activity({ id }); ingestHistory(id, rows) }
}, { immediate: true })
watch(() => items.value.length, async () => { await nextTick(); if (list.value) list.value.scrollTop = list.value.scrollHeight })
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
      <div v-for="it in items" :key="it.id" class="act" :class="it.kind">
        <div class="act-marker">{{ icon[it.kind] }}</div>
        <div class="act-body">
          <div class="act-head"><span>{{ label[it.kind] }}</span><span class="muted">{{ time(it.at) }}</span></div>
          <div class="act-text">{{ it.text }}</div>
        </div>
      </div>
      <div v-if="!items.length" class="empty">Structured agent activity appears here. The terminal stays the source of truth.</div>
    </div>
    <VoiceBar />
  </aside>
</template>
