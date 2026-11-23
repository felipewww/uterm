<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { cancelRecording, coachEnabled, discardDraft, drafts, isRecording, recorder, runCoach, startRecording, stopRecording, submitDraft, useMine, useNatural } from '../composables/useRecorder'
import { ON_MAC, coachOnFor } from '@shared/types'
import { prettyShortcut } from '../shortcut'
import { focusTerminal } from '../terminals'
import { selected, store } from '../store'

const s = computed(() => selected())
const draft = computed(() => (s.value ? drafts[s.value.id] : undefined))
const recordingElsewhere = computed(() => !!recorder.activeSessionId && recorder.activeSessionId !== s.value?.id)
const audioDown = computed(() => store.settings.sttProvider === 'local' && !store.status.stt)
const sttNoKey = computed(() => store.settings.sttProvider !== 'local' && !store.keys[store.settings.sttProvider])
const shortcut = computed(() => prettyShortcut(store.settings.recordShortcut, ON_MAC))
const sendKeys = ON_MAC ? '⌘ Enter' : 'Ctrl + Enter'
const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
const canSend = computed(() => !!s.value?.running && !!draft.value?.text.trim())
const coachWanted = computed(() => coachOnFor(store.settings.englishCoach, s.value?.englishCoach)) // this chat's choice, else the global one
const coachOn = computed(() => !!s.value && coachEnabled(s.value.id))
const coachNeedsKey = computed(() => coachWanted.value && !store.keys.openai)
const coachOffHere = computed(() => !coachWanted.value && s.value?.englishCoach === false)
async function setCoach(on: boolean) { if (s.value) await window.echo.sessions.update({ id: s.value.id, patch: { englishCoach: on } }) }
// Recording takes the keyboard: focus leaves the terminal for the recorder (so typing cannot reach the agent), and moves to the transcription when it is ready.
const recRow = ref<HTMLElement | null>(null)
const draftEl = ref<HTMLTextAreaElement | null>(null)
watch(() => draft.value?.status, async (st, prev) => {
  await nextTick()
  if (st === 'recording') recRow.value?.focus()
  else if (st === 'review' && prev === 'transcribing') draftEl.value?.focus()
})
const bars = Array.from({ length: 26 }, (_, i) => i)

const idleTitle = computed(() => !s.value?.running ? 'Session closed' : recordingElsewhere.value ? 'Recorder in use' : sttNoKey.value ? 'Cloud API key missing' : audioDown.value ? 'Speech-to-text offline' : 'Voice message')
const idleHint = computed(() => !s.value?.running ? 'Resume it to record a message' : recordingElsewhere.value ? 'Finish the other recording first' : sttNoKey.value ? 'Add the key in Settings → Voice' : audioDown.value ? 'The terminal remains available' : 'Record, review, then send')

function discardRecording() { const id = s.value?.id; cancelRecording(); if (id) focusTerminal(id) }
async function toggle() {
  if (!s.value) return
  if (isRecording()) stopRecording()
  else await startRecording(s.value.id)
}
async function send() {
  if (!s.value || !draft.value || !canSend.value) return
  await submitDraft(s.value.id, false, !!draft.value.note)
}
async function rerecord() {
  if (!s.value) return
  discardDraft(s.value.id)
  await startRecording(s.value.id)
}
</script>

<template>
  <div v-if="s && s.agentType !== 'shell'" class="composer" :class="draft?.status ?? 'idle'">
    <!-- idle -->
    <div v-if="!draft" class="composer-row">
      <button class="mic" :disabled="!s.running || recordingElsewhere" title="Record voice message" aria-label="Record voice message" @click="toggle">
        <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="5.25" y="1.75" width="5.5" height="8.25" rx="2.75" /><path d="M3.25 7.75a4.5 4.5 0 0 0 9 0M8 12.25v2M5.75 14.25h4.5" /></svg>
      </button>
      <span class="composer-text"><strong>{{ idleTitle }}</strong><small>{{ idleHint }}</small></span>
      <kbd v-if="s.running && !audioDown && !recordingElsewhere" class="kbd" title="Recording shortcut">{{ shortcut }}</kbd>
    </div>

    <!-- recording -->
    <template v-else-if="draft.status === 'recording'">
      <div ref="recRow" class="composer-row rec-focus" tabindex="-1">
        <span class="rec-time"><i class="rec-dot"></i>{{ mmss(draft.seconds) }}</span>
        <div class="wave" aria-hidden="true"><i v-for="n in bars" :key="n" :style="{ '--i': n }"></i></div>
        <button class="btn ghost icon-only" title="Discard recording (Esc)" aria-label="Discard recording" @click="discardRecording"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
        <button class="mic rec" title="Stop and transcribe (Enter)" aria-label="Stop and transcribe" @click="toggle"><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /></svg></button>
      </div>
      <p class="composer-hint">Recording for <strong>{{ s.title }}</strong> · <kbd class="kbd">Enter</kbd> to finish · <kbd class="kbd">Esc</kbd> to discard</p>
    </template>

    <!-- transcribing -->
    <template v-else-if="draft.status === 'transcribing'">
      <div class="composer-row"><span class="spinner"></span><span class="composer-text"><strong>Transcribing</strong><small>Processing audio locally</small></span></div>
      <div class="progress-line"></div>
    </template>

    <!-- error -->
    <template v-else-if="draft.status === 'error'">
      <div class="banner danger" role="alert">{{ draft.error }}</div>
      <div class="composer-actions">
        <button class="btn ghost" @click="discardDraft(s.id)">Dismiss</button>
        <button class="btn" :disabled="!s.running || recordingElsewhere" @click="rerecord"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8" /></svg>Try again</button>
      </div>
    </template>

    <!-- review -->
    <template v-else>
      <div class="composer-label"><span>Transcription</span><span class="to">→ {{ s.title }}</span></div>
      <textarea ref="draftEl" v-model="draft.text" class="draft" placeholder="Review the transcription before sending…" @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send"></textarea>
      <div v-if="coachOn" class="coach" :class="draft.coach?.status ?? 'loading'">
        <div class="composer-label">
          <span>More natural English</span>
          <span class="coach-tools">
            <button class="coach-link" title="Generate it again from the text above" :disabled="draft.coach?.status === 'loading'" @click="runCoach(s.id)">↻ Redo</button>
            <button class="coach-link" title="Stop showing this for this chat (you can turn it back on in the chat's voice settings)" @click="setCoach(false)">Off for this chat</button>
          </span>
        </div>
        <p v-if="!draft.coach || draft.coach.status === 'loading'" class="coach-loading"><span class="spinner mini"></span>Polishing your sentence…</p>
        <p v-else-if="draft.coach.status === 'error'" class="coach-error">{{ draft.coach.error }}</p>
        <template v-else>
          <div class="coach-text">{{ draft.coach.text }}</div>
          <div class="coach-actions">
            <button class="btn small" :disabled="draft.text === draft.coach.text" @click="useNatural(s.id)">Use this version</button>
            <button v-if="draft.original && draft.text !== draft.original" class="btn small ghost" @click="useMine(s.id)">Back to mine</button>
          </div>
        </template>
      </div>
      <p v-else-if="coachOffHere" class="coach-hint">English coach is off for this chat. <button class="coach-link" @click="setCoach(true)">Turn on</button></p>
      <p v-else-if="coachNeedsKey" class="coach-hint">English coach is on but needs an OpenAI key (Settings → Voice).</p>
      <div v-if="draft.note" class="banner warn">{{ draft.note }}</div>
      <div class="composer-actions">
        <button class="btn ghost discard" title="Discard transcription" @click="discardDraft(s.id)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 4.75 1 8h7l1-8M2.5 3.25h11M6 3.25V2h4v1.25M6.5 6.5v3.5M9.5 6.5v3.5" /></svg>Discard</button>
        <span class="spacer"></span>
        <button class="btn ghost icon-only" title="Record again" aria-label="Record again" :disabled="!s.running || recordingElsewhere" @click="rerecord"><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="5.25" y="1.75" width="5.5" height="8.25" rx="2.75" /><path d="M3.25 7.75a4.5 4.5 0 0 0 9 0M8 12.25v2M5.75 14.25h4.5" /></svg></button>
        <button class="btn primary send" :disabled="!canSend" :title="canSend ? `Send to the agent (${sendKeys})` : 'Nothing to send'" @click="send">
          Send<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m2.25 2.5 11.5 5.5-11.5 5.5 2-5.5zM4.25 8h9.25" /></svg><kbd class="kbd on-accent">{{ ON_MAC ? '⌘ ↵' : 'Ctrl ↵' }}</kbd>
        </button>
      </div>
    </template>
  </div>
</template>
