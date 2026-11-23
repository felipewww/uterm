<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { SessionView } from '@shared/types'
import type { AnyAgentEvent } from '@shared/events'
import SidePanel from './components/SidePanel.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'
import ResizeHandle from './components/ResizeHandle.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import SessionTabs from './components/SessionTabs.vue'
import SessionToolbar from './components/SessionToolbar.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TerminalPane from './components/TerminalPane.vue'
import WelcomePanel from './components/WelcomePanel.vue'
import { installAudioPlayer } from './composables/useAudioPlayer'
import { cancelRecording, discardDraft, isRecording, recorder, startRecording, stopRecording } from './composables/useRecorder'
import { playChime } from './chime'
import { chimeFor } from './notify'
import { isEditableTarget, matchesShortcut, recordingKeyAction } from './shortcut'
import { ingestEvent, layout, markSpoken, notify, resetActivity, refreshStatus, refreshUsage, removeSession, resetSidebar, setNatural, resizeActivity, resizeSidebar, store, upsertSession } from './store'
import { disposeTerminal, focusTerminal, writeTo } from './terminals'

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

let lastChime = 0
function chimeOnEvent(e: AnyAgentEvent) {
  const kind = chimeFor({
    eventType: e.type, blocker: e.type === 'AGENT_ERROR' ? !!e.payload.blocker : undefined, sessionId: e.sessionId, selectedId: store.selectedId,
    windowFocused: document.hasFocus(), sessionMuted: !!store.sessions.find((s) => s.id === e.sessionId)?.muted, recording: isRecording(), settings: store.settings
  })
  if (!kind || Date.now() - lastChime < 900) return // several events at once make one sound
  lastChime = Date.now()
  playChime(kind, store.settings.notifyVolume)
}

async function select(id: string | null) {
  store.selectedId = id
  await window.echo.sessions.select(id ? { id } : null)
}

let swallowEnterUntil = 0
function onKey(e: KeyboardEvent) {
  // While recording: Enter = done, Escape = discard. The terminal must not also receive them (Enter would submit the CLI's prompt, Escape would interrupt the agent), nor a second Enter tapped right after.
  if (e.key === 'Enter' && Date.now() < swallowEnterUntil && !isEditableTarget(e.target)) { e.preventDefault(); e.stopPropagation(); return }
  const action = recordingKeyAction({
    recording: isRecording(), key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, repeat: e.repeat, composing: e.isComposing,
    editable: isEditableTarget(e.target), modalOpen: !!document.querySelector('.modal-backdrop')
  })
  if (action) {
    e.preventDefault(); e.stopPropagation()
    if (action === 'stop') { swallowEnterUntil = Date.now() + 450; stopRecording() }
    else { const id = recorder.activeSessionId; cancelRecording(); if (id) focusTerminal(id) } // discarded: back to the terminal you were in
    return
  }
  if (!matchesShortcut(e, store.settings.recordShortcut)) return
  e.preventDefault()
  e.stopPropagation()
  if (isRecording()) stopRecording()
  else if (store.selectedId) void startRecording(store.selectedId)
}

/** Bring back the tabs of the last run: plain terminals start again in the folder they were in, agents wait for you to resume. */
async function restoreTabs() {
  const ids: string[] = await window.echo.app.restoreTabs()
  for (const id of ids) {
    const s = store.sessions.find((x) => x.id === id)
    if (!s || s.running) continue
    if (s.agentType === 'shell') { try { await window.echo.sessions.start({ id, cols: 100, rows: 30 }) } catch { /* the folder may be gone: leave it as a closed tab */ store.restoredTabs.push(id) } }
    else store.restoredTabs.push(id)
  }
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
    ev.onActivity((e) => { ingestEvent(e as AnyAgentEvent); chimeOnEvent(e as AnyAgentEvent) }),
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
        await restoreTabs() // the app always starts on Home, with the tabs of the last run next to it
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
    <SessionSidebar @select="select" @create="showNew = true" @settings="(p) => { settingsPane = p; showSettings = true }" @usage="settingsPane = 'usage'; showSettings = true" />
    <ResizeHandle label="Resize sessions panel" @resize="resizeSidebar" @reset="resetSidebar" />
    <main class="center">
      <section class="terminal-card">
        <SessionTabs @select="select" />
        <SessionToolbar @settings="showSessionSettings = true" />
        <TerminalPane v-show="store.selectedId" />
        <WelcomePanel v-if="!store.selectedId" @create="showNew = true" @select="select" />
      </section>
    </main>
    <template v-if="store.showActivity">
      <ResizeHandle label="Resize activity panel" @resize="resizeActivity" @reset="resetActivity" />
      <SidePanel />
    </template>

    <NewSessionDialog v-if="showNew" @close="showNew = false" @created="created" />
    <SettingsDialog v-if="showSettings" :pane="settingsPane" @close="showSettings = false; void refreshUsage()" />
    <SettingsDialog v-if="showSessionSettings" :session-id="store.selectedId" @close="showSessionSettings = false" />

    <div v-if="store.confirmQuit" class="modal-backdrop">
      <div class="modal">
        <h2>Quit uTerm?</h2>
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
        <p><strong>{{ store.confirmDelete.title }}</strong> will be removed from uTerm{{ store.confirmDelete.running ? ' and its running agent stopped' : '' }}, together with its saved activity and spoken-message history. This cannot be undone.</p>
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
