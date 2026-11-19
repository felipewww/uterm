<script setup lang="ts">
import { computed } from 'vue'
import { cancelRecording, discardDraft, drafts, isRecording, recorder, startRecording, stopRecording, submitDraft } from '../composables/useRecorder'
import { selected, store } from '../store'

const s = computed(() => selected())
const draft = computed(() => (s.value ? drafts[s.value.id] : undefined))
const recordingElsewhere = computed(() => !!recorder.activeSessionId && recorder.activeSessionId !== s.value?.id)
const audioDown = computed(() => !store.status.stt)
const shortcut = computed(() => store.settings.recordShortcut.replace('Control', 'Ctrl').split('+').join(' + '))
const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
const canSend = computed(() => !!s.value?.running && !!draft.value?.text.trim())
const bars = Array.from({ length: 26 }, (_, i) => i)

const idleTitle = computed(() => !s.value?.running ? 'Session closed' : recordingElsewhere.value ? 'Recorder in use' : audioDown.value ? 'Speech-to-text offline' : 'Voice message')
const idleHint = computed(() => !s.value?.running ? 'Resume it to record a message' : recordingElsewhere.value ? 'Finish the other recording first' : audioDown.value ? 'The terminal remains available' : 'Record, review, then send')

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
  <div v-if="s" class="composer" :class="draft?.status ?? 'idle'">
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
      <div class="composer-row">
        <span class="rec-time"><i class="rec-dot"></i>{{ mmss(draft.seconds) }}</span>
        <div class="wave" aria-hidden="true"><i v-for="n in bars" :key="n" :style="{ '--i': n }"></i></div>
        <button class="btn ghost icon-only" title="Cancel recording" aria-label="Cancel recording" @click="cancelRecording"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
        <button class="mic rec" title="Stop and transcribe" aria-label="Stop and transcribe" @click="toggle"><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1" /></svg></button>
      </div>
      <p class="composer-hint">Recording for <strong>{{ s.title }}</strong> · press stop to transcribe</p>
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
      <textarea v-model="draft.text" class="draft" placeholder="Review the transcription before sending…" @keydown.ctrl.enter.prevent="send" @keydown.meta.enter.prevent="send"></textarea>
      <div v-if="draft.note" class="banner warn">{{ draft.note }}</div>
      <div class="composer-actions">
        <button class="btn ghost discard" title="Discard transcription" @click="discardDraft(s.id)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 4.75 1 8h7l1-8M2.5 3.25h11M6 3.25V2h4v1.25M6.5 6.5v3.5M9.5 6.5v3.5" /></svg>Discard</button>
        <span class="spacer"></span>
        <button class="btn ghost icon-only" title="Record again" aria-label="Record again" :disabled="!s.running || recordingElsewhere" @click="rerecord"><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="5.25" y="1.75" width="5.5" height="8.25" rx="2.75" /><path d="M3.25 7.75a4.5 4.5 0 0 0 9 0M8 12.25v2M5.75 14.25h4.5" /></svg></button>
        <button class="btn primary send" :disabled="!canSend" :title="canSend ? 'Send to the agent (Ctrl+Enter)' : 'Nothing to send'" @click="send">
          Send<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m2.25 2.5 11.5 5.5-11.5 5.5 2-5.5zM4.25 8h9.25" /></svg><kbd class="kbd on-accent">Ctrl ↵</kbd>
        </button>
      </div>
    </template>
  </div>
</template>
