<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { AGENT_LABELS } from '@shared/types'
import VoiceBar from './VoiceBar.vue'
import { parseVoiceId } from '@shared/voices'
import { totalOf, togglePlay, seekTo, tracks } from '../composables/useAudioPlayer'
import { renderMarkdown } from '../markdown'
import { mmss } from '../wavInfo'
import { generatingFor, ingestHistory, notify, selected, store, voiceOf, type ActivityItem } from '../store'

const list = ref<HTMLElement | null>(null)
const items = computed(() => (store.selectedId ? store.activity[store.selectedId] ?? [] : []))
const op = computed(() => (store.selectedId ? store.currentOp[store.selectedId] : ''))
const agent = computed(() => (selected() ? AGENT_LABELS[selected()!.agentType].short : 'Agent'))
const chip = (it: ActivityItem) => ({ progress: 'Update', final: it.full ? 'Summary' : 'Result', question: 'Question', permission: 'Needs permission', error: 'Error', attention: 'Notice', prompt: '', tool: 'Tool' })[it.kind]
const who = (it: ActivityItem) => (it.kind === 'error' ? 'Error' : it.kind === 'attention' ? 'Echo-Term' : agent.value)

watch(() => store.selectedId, async (id) => {
  if (id) { const rows = await window.echo.sessions.activity({ id }); ingestHistory(id, rows) }
}, { immediate: true })
watch(() => items.value.length, async () => { await nextTick(); if (list.value) list.value.scrollTop = list.value.scrollHeight })

const LISTENABLE = new Set(['progress', 'final', 'question', 'permission'])
const active = (it: ActivityItem) => store.audio.speakingEventId === it.id
const generating = (it: ActivityItem) => active(it) && store.audio.phase === 'generating' // nothing to hear yet
const queued = (it: ActivityItem) => store.audio.queuedEventIds.includes(it.id)
const track = (it: ActivityItem) => tracks[it.id]
const hasAudio = (it: ActivityItem) => !!track(it)?.chunks.length
const playing = (it: ActivityItem) => track(it)?.status === 'playing'
async function listen(it: ActivityItem) {
  if (!store.selectedId) return
  if (track(it)?.complete) { await togglePlay(it.id); return } // replay from memory, no new synthesis
  const vp = parseVoiceId(voiceOf(selected())).provider
  if (vp === 'local' && !store.enabled.tts) { notify('info', 'Text-to-speech is off. Turn it on with the TTS chip at the bottom left.', 5000); return }
  if (vp !== 'local' && !store.keys[vp]) { notify('info', 'This chat uses a cloud voice but its API key is missing. See Settings → Cloud voice.', 5000); return }
  if (active(it)) { await window.echo.voice.stopPlayback(); return }
  await window.echo.voice.listen({ id: store.selectedId, text: it.speech ?? it.text, ref: it.id })
}

// player: a range input scrubs across the whole message; the seek happens on release (or a key press)
const scrub = reactive<Record<string, number | undefined>>({})
const pos = (it: ActivityItem) => scrub[it.id] ?? track(it)?.position ?? 0
const pct = (it: ActivityItem) => { const t = track(it); const total = t ? totalOf(t) : 0; return total > 0 ? `${Math.min(100, (pos(it) / total) * 100)}%` : '0%' }
const onScrub = (it: ActivityItem, e: Event) => { scrub[it.id] = Number((e.target as HTMLInputElement).value) }
async function commitScrub(it: ActivityItem, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  scrub[it.id] = undefined
  await seekTo(it.id, v)
}
const totalLabel = (it: ActivityItem) => { const t = track(it); return t ? mmss(totalOf(t)) + (t.complete ? '' : '+') : '' }

// long messages are clamped; the full response behind a summary is collapsed by default
const open = reactive<Record<string, boolean>>({})
const LONG = 420
const isLong = (it: ActivityItem) => !it.full && it.kind !== 'prompt' && it.text.length > LONG
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <aside class="activity">
    <div class="activity-head">
      <span>Activity</span>
      <span class="muted">{{ selected()?.runtimeState.replaceAll('_', ' ').toLowerCase() }}</span>
    </div>
    <div ref="list" class="chat">
      <article v-for="it in items" :key="it.id" class="msg" :class="[it.kind, { spoken: it.spoken, playing: playing(it), generating: generating(it) }]">
        <!-- you -->
        <template v-if="it.kind === 'prompt'">
          <div class="bubble">{{ it.text }}</div>
          <div class="msg-time">You · {{ time(it.at) }}</div>
        </template>

        <!-- agent / system -->
        <template v-else>
          <header class="msg-head">
            <span class="who">{{ who(it) }}</span>
            <span v-if="chip(it)" class="chip" :class="it.kind">{{ chip(it) }}</span>
            <svg v-if="it.spoken" class="spoken-mark" viewBox="0 0 16 16" aria-label="Spoken aloud"><title>Spoken aloud</title><path d="M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5" /></svg>
            <span v-if="generating(it)" class="voice-status generating" role="status"><span class="spinner mini"></span>Generating audio… {{ generatingFor() }}s</span>
            <span v-else-if="queued(it)" class="voice-status" role="status">Waiting for the voice</span>
            <span class="msg-time">{{ time(it.at) }}</span>
            <button v-if="LISTENABLE.has(it.kind) && !hasAudio(it)" class="listen-btn" :class="{ on: active(it) }" :title="active(it) ? 'Stop' : 'Listen'" :aria-label="active(it) ? 'Stop audio' : 'Listen to this message'" @click="listen(it)">
              <svg v-if="!active(it)" aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3.25v9.5L12.5 8z" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /></svg>
            </button>
          </header>
          <div class="msg-body" :class="{ clamped: isLong(it) && !open[it.id] }">{{ it.text }}</div>
<!-- audio player: appears once the voice has produced (or replayed) this message -->
          <div v-if="hasAudio(it)" class="player" :class="track(it)!.status">
            <button class="pl-btn" :title="playing(it) ? 'Pause' : 'Play'" :aria-label="playing(it) ? 'Pause' : 'Play'" @click="togglePlay(it.id)">
              <span v-if="track(it)!.status === 'buffering'" class="spinner mini"></span>
              <svg v-else-if="playing(it)" aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3.5v9M11 3.5v9" /></svg>
              <svg v-else aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3.25v9.5L12.5 8z" /></svg>
            </button>
            <input class="pl-seek" type="range" min="0" :max="Math.max(totalOf(track(it)!), 0.1)" step="0.05" :value="pos(it)" :style="{ '--pct': pct(it) }" aria-label="Seek audio" @input="onScrub(it, $event)" @change="commitScrub(it, $event)" />
            <span class="pl-time" :title="track(it)!.complete ? 'Audio length' : 'The voice is still generating the rest'">{{ mmss(pos(it)) }} / {{ totalLabel(it) }}</span>
          </div>
          <button v-if="isLong(it)" class="more" @click="open[it.id] = !open[it.id]">{{ open[it.id] ? 'Show less' : 'Show more' }}</button>
          <template v-if="it.full">
            <button class="more" :aria-expanded="!!open[it.id]" @click="open[it.id] = !open[it.id]">
              <svg class="chev" :class="{ open: open[it.id] }" aria-hidden="true" viewBox="0 0 16 16"><path d="m6 4 4 4-4 4" /></svg>{{ open[it.id] ? 'Hide full response' : 'Full response' }}
            </button>
            <!-- eslint-disable-next-line vue/no-v-html -- renderMarkdown escapes all input -->
            <div v-if="open[it.id]" class="full md" v-html="renderMarkdown(it.full)"></div>
          </template>
        </template>
      </article>
      <div v-if="!items.length" class="empty">Structured agent activity appears here. The terminal stays the source of truth.</div>
    </div>
    <div v-if="op" class="current-op"><span class="op-dot"></span>{{ op }}</div>
    <VoiceBar />
  </aside>
</template>
