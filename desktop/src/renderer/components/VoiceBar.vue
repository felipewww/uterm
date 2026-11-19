<script setup lang="ts">
import { computed } from 'vue'
import { cancelRecording, discardDraft, drafts, isRecording, recorder, startRecording, stopRecording, submitDraft } from '../composables/useRecorder'
import { selected, store } from '../store'

const s = computed(() => selected())
const draft = computed(() => (s.value ? drafts[s.value.id] : undefined))
const recordingElsewhere = computed(() => recorder.activeSessionId && recorder.activeSessionId !== s.value?.id)
const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
const audioDown = computed(() => !store.status.stt)

async function toggle() {
  if (!s.value) return
  if (isRecording()) stopRecording()
  else await startRecording(s.value.id)
}
async function send() {
  if (!s.value || !draft.value) return
  await submitDraft(s.value.id, false, !!draft.value.note)
}
</script>

<template>
  <div v-if="s" class="voicebar">
    <div class="voice-row">
      <button class="mic" :class="{ rec: draft?.status === 'recording' }" :disabled="!s.running || !!recordingElsewhere || draft?.status === 'transcribing'"
        :title="`Record (${store.settings.recordShortcut})`" @click="toggle">
        {{ draft?.status === 'recording' ? '⏹' : '🎙' }}
      </button>
      <template v-if="!draft">
        <span class="muted">
          {{ !s.running ? 'Resume the session to talk to it.' : recordingElsewhere ? 'Another session is recording.' : `Press ${store.settings.recordShortcut} or the mic to record a voice message.` }}
          <span v-if="audioDown" class="warn-text"> Speech-to-text is offline; the terminal still works.</span>
        </span>
      </template>
      <template v-else-if="draft.status === 'recording'">
        <span class="rec-dot"></span><span>Recording {{ mmss(draft.seconds) }} → <strong>{{ s.title }}</strong></span>
        <button class="btn" @click="cancelRecording">Cancel</button>
      </template>
      <template v-else-if="draft.status === 'transcribing'"><span class="spinner"></span><span>Transcribing locally…</span></template>
      <template v-else-if="draft.status === 'error'">
        <span class="error-text">{{ draft.error }}</span><button class="btn" @click="discardDraft(s.id)">Dismiss</button>
      </template>
      <template v-else>
        <textarea v-model="draft.text" class="draft" rows="2" placeholder="Edit transcription…" @keydown.enter.exact.prevent="send"></textarea>
        <div class="draft-actions">
          <button class="btn primary" :disabled="!s.running" @click="send">Send to {{ s.title }}</button>
          <button class="btn" @click="discardDraft(s.id)">Discard</button>
        </div>
      </template>
    </div>
    <div v-if="draft?.status === 'review' && draft.note" class="note">{{ draft.note }}</div>
  </div>
</template>
