<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SessionView } from '@shared/types'
import type { AnyAgentEvent } from '@shared/events'
import ActivityPanel from './components/ActivityPanel.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'
import ResizeHandle from './components/ResizeHandle.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import SessionToolbar from './components/SessionToolbar.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TerminalPane from './components/TerminalPane.vue'
import WelcomePanel from './components/WelcomePanel.vue'
import { installAudioPlayer } from './composables/useAudioPlayer'
import { discardDraft, isRecording, startRecording, stopRecording } from './composables/useRecorder'
import { matchesShortcut } from './shortcut'
import { ingestEvent, layout, markSpoken, notify, resetActivity, refreshStatus, refreshUsage, removeSession, resetSidebar, setNatural, resizeActivity, resizeSidebar, store, upsertSession } from './store'
import { disposeTerminal, writeTo } from './terminals'

const showNew = ref(false)
const showSettings = ref(false)
const settingsPane = ref<string | undefined>(undefined) // which pane the Settings dialog opens on
const showSessionSettings = ref(false)
const offs: Array<() => void> = []
let statusTimer: number | undefined
let usageTimer: number | undefined

const cancelDelete = ref<HTMLButtonElement | null>(null)
watch(() => store.confirmDelete, async (s) => { if (s) { await nextTick(); cancelDelete.value?.focus() } }) // the safe choice has the focus
async function confirmDeleteSession() {
  const s = store.confirmDelete
  store.confirmDelete = null
  if (!s) return
  try { await window.echo.sessions.remove({ id: s.id }) } catch (err) { notify('error', `Could not delete the session: ${(err as Error).message}`) }
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
    ev.onSessionRemoved(({ id }) => { disposeTerminal(id); discardDraft(id); removeSession(id) }),
    ev.onCoachNatural((p) => setNatural(p.sessionId, p.eventId, p.natural)),
    ev.onFolders((f) => { store.folders = f as typeof store.folders }),
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
    store.folders = await window.echo.folders.list()
    store.voices = await window.echo.voice.list()
    // Fresh start: show the welcome screen. Only a reloaded window with agents still running goes straight to one.
    const running = store.sessions.find((s) => s.running)
    if (running) await select(running.id)
  } catch (err) {
    notify('error', `Startup problem: ${(err as Error).message}`)
  }
  void refreshStatus()
  void refreshUsage()
  usageTimer = window.setInterval(refreshUsage, 30_000)
  statusTimer = window.setInterval(refreshStatus, 8000)
})

onBeforeUnmount(() => {
  offs.forEach((o) => o())
  clearInterval(statusTimer)
  clearInterval(usageTimer)
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
    <SessionSidebar @select="select" @home="select(null)" @create="showNew = true" @settings="settingsPane = undefined; showSettings = true" @usage="settingsPane = 'usage'; showSettings = true" />
    <ResizeHandle label="Resize sessions panel" @resize="resizeSidebar" @reset="resetSidebar" />
    <main class="center">
      <section class="terminal-card">
        <SessionToolbar @settings="showSessionSettings = true" />
        <TerminalPane v-show="store.selectedId" />
        <WelcomePanel v-if="!store.selectedId" @create="showNew = true" @select="select" />
      </section>
    </main>
    <template v-if="store.showActivity">
      <ResizeHandle label="Resize activity panel" @resize="resizeActivity" @reset="resetActivity" />
      <ActivityPanel />
    </template>

    <NewSessionDialog v-if="showNew" @close="showNew = false" @created="created" />
    <SettingsDialog v-if="showSettings" :pane="settingsPane" @close="showSettings = false; void refreshUsage()" />
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

    <div v-if="store.confirmDelete" class="modal-backdrop" @click.self="store.confirmDelete = null" @keydown.esc="store.confirmDelete = null">
      <div class="modal" role="alertdialog" aria-labelledby="del-title">
        <h2 id="del-title">Delete this session?</h2>
        <p><strong>{{ store.confirmDelete.title }}</strong> will be removed from Echo-Term{{ store.confirmDelete.running ? ' and its running agent stopped' : '' }}, together with its saved activity and spoken-message history. This cannot be undone.</p>
        <p class="muted">The agent's own conversation files (for example under ~/.claude or ~/.codex) are left on disk.</p>
        <div class="modal-actions">
          <button ref="cancelDelete" class="btn" @click="store.confirmDelete = null">Cancel</button>
          <button class="btn danger" @click="confirmDeleteSession">Delete session</button>
        </div>
      </div>
    </div>

    <div class="toasts">
      <div v-for="n in store.notices" :key="n.id" class="toast" :class="n.level">{{ n.message }}</div>
    </div>
  </div>
</template>
