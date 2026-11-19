<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SessionView } from '@shared/types'
import type { AnyAgentEvent } from '@shared/events'
import ActivityPanel from './components/ActivityPanel.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'
import ResizeHandle from './components/ResizeHandle.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import SessionToolbar from './components/SessionToolbar.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TerminalPane from './components/TerminalPane.vue'
import { installAudioPlayer } from './composables/useAudioPlayer'
import { isRecording, startRecording, stopRecording } from './composables/useRecorder'
import { matchesShortcut } from './shortcut'
import { ingestEvent, layout, markSpoken, notify, resetActivity, resetSidebar, resizeActivity, resizeSidebar, store, upsertSession } from './store'
import { writeTo } from './terminals'

const showNew = ref(false)
const showSettings = ref(false)
const showSessionSettings = ref(false)
const offs: Array<() => void> = []
let statusTimer: number | undefined

async function refreshStatus() {
  try {
    const s = await window.echo.status.get()
    Object.assign(store.status, { stt: s.stt, tts: s.tts, ttsReady: s.ttsReady, db: s.db })
    store.agents = s.agents
    store.capabilities = s.capabilities
  } catch { /* main may be busy; try again on the next tick */ }
}

async function select(id: string | null) {
  store.selectedId = id
  await window.echo.sessions.select(id ? { id } : null)
}

function onKey(e: KeyboardEvent) {
  if (!matchesShortcut(e, store.settings.recordShortcut)) return
  e.preventDefault()
  e.stopPropagation()
  if (isRecording()) stopRecording()
  else if (store.selectedId) void startRecording(store.selectedId)
}

onMounted(async () => {
  // Subscribe first: a failed initial load must never leave the UI deaf to events.
  const ev = window.echo.events
  offs.push(
    ev.onPtyData(({ id, data }) => writeTo(id, data)),
    ev.onPtyExit(({ id }) => {
      const s = store.sessions.find((x) => x.id === id)
      if (s) notify('info', `"${s.title}" closed.`, 3000)
    }),
    ev.onSessionView((v) => upsertSession(v as SessionView)),
    ev.onActivity((e) => ingestEvent(e as AnyAgentEvent)),
    ev.onAudioState((s) => { store.audio = s }),
    ev.onSpoken((p) => markSpoken(p.sessionId, p.eventId)),
    ev.onNotice((n) => notify(n.level, n.message)),
    ev.onSettings((s) => { store.settings = s as typeof store.settings }),
    ev.onConfirmQuit(() => { store.confirmQuit = true }),
    installAudioPlayer()
  )
  window.addEventListener('keydown', onKey, true)
  try {
    store.settings = await window.echo.settings.get()
    store.sessions = await window.echo.sessions.list()
    store.voices = await window.echo.voice.list()
    const first = store.sessions.find((s) => s.running) ?? store.sessions.find((s) => !s.archivedAt)
    if (first) await select(first.id)
  } catch (err) {
    notify('error', `Startup problem: ${(err as Error).message}`)
  }
  void refreshStatus()
  statusTimer = window.setInterval(refreshStatus, 8000)
})

onBeforeUnmount(() => {
  offs.forEach((o) => o())
  clearInterval(statusTimer)
  window.removeEventListener('keydown', onKey, true)
})

async function created(id: string) {
  showNew.value = false
  await select(id)
}
async function quit() {
  store.confirmQuit = false
  await window.echo.app.confirmQuit()
}
</script>

<template>
  <div class="app" :class="{ 'no-activity': !store.showActivity }" :style="{ '--sidebar-width': layout.sidebarW + 'px', '--activity-width': layout.activityW + 'px' }">
    <SessionSidebar @select="select" @create="showNew = true" @settings="showSettings = true" />
    <ResizeHandle label="Resize sessions panel" @resize="resizeSidebar" @reset="resetSidebar" />
    <main class="center">
      <section class="terminal-card">
        <SessionToolbar @settings="showSessionSettings = true" />
        <TerminalPane />
      </section>
    </main>
    <template v-if="store.showActivity">
      <ResizeHandle label="Resize activity panel" @resize="resizeActivity" @reset="resetActivity" />
      <ActivityPanel />
    </template>

    <NewSessionDialog v-if="showNew" @close="showNew = false" @created="created" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <SettingsDialog v-if="showSessionSettings" :session-id="store.selectedId" @close="showSessionSettings = false" />

    <div v-if="store.confirmQuit" class="modal-backdrop">
      <div class="modal">
        <h2>Quit Echo-Term?</h2>
        <p>Running agent sessions will be stopped. Their conversations stay saved and can be resumed.</p>
        <div class="modal-actions">
          <button class="btn" @click="store.confirmQuit = false">Keep running</button>
          <button class="btn danger" @click="quit">Quit and stop agents</button>
        </div>
      </div>
    </div>

    <div class="toasts">
      <div v-for="n in store.notices" :key="n.id" class="toast" :class="n.level">{{ n.message }}</div>
    </div>
  </div>
</template>
