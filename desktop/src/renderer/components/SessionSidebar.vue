<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import type { SessionView } from '@shared/types'
import { notify, store } from '../store'

const emit = defineEmits<{ select: [id: string]; create: []; settings: [] }>()
const query = ref('')
const showArchived = ref(false)
const collapsed = reactive<Record<string, boolean>>({})
const editingId = ref<string | null>(null)
const editText = ref('')
const editInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)
const menu = ref<{ x: number; y: number; s: SessionView } | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.sessions
    .filter((s) => (showArchived.value ? true : !s.archivedAt))
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.workingDirectory.toLowerCase().includes(q) || s.agentType.includes(q))
})
const groups = computed(() => [
  { name: 'Active', list: filtered.value.filter((s) => s.running) },
  { name: 'Closed', list: filtered.value.filter((s) => !s.running) }
].filter((g) => g.list.length))
const visible = computed(() => groups.value.flatMap((g) => (collapsed[g.name] ? [] : g.list)))
const totalCount = computed(() => store.sessions.filter((s) => !s.archivedAt).length)

const stateLabel: Record<string, string> = {
  STARTING: 'Starting', IDLE: 'Idle', WORKING: 'Working', WAITING_FOR_INPUT: 'Needs input',
  WAITING_FOR_PERMISSION: 'Needs permission', ERROR: 'Error', CLOSED: 'Closed'
}
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
// "~/projects/a/b/echo-term" -> "…/b/echo-term": keep the last two segments, the full path is in the tooltip.
const shortDir = (p: string) => {
  const parts = p.replace(/^\/home\/[^/]+/, '~').split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : parts.join('/') || '/'
}
const agentName = (s: SessionView) => (s.agentType === 'claude' ? 'Claude' : 'Codex')
const tip = (s: SessionView) => `${s.title}\n${agentName(s)} · ${s.workingDirectory}\n${stateLabel[s.runtimeState]}${s.muted ? ' · muted' : ''}`

async function startEdit(s: SessionView) {
  editingId.value = s.id; editText.value = s.title
  await nextTick()
  const el = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value
  el?.focus(); el?.select()
}
async function commitEdit() {
  const id = editingId.value
  editingId.value = null
  if (id && editText.value.trim()) await window.echo.sessions.rename({ id, title: editText.value.trim() })
}
async function close(s: SessionView) { await window.echo.sessions.stop({ id: s.id }) }
async function archive(s: SessionView) { await window.echo.sessions.archive({ id: s.id, archived: !s.archivedAt }) }

// keyboard: ↑/↓ move the selection, F2 renames
function onKey(e: KeyboardEvent) {
  if (editingId.value) return
  const list = visible.value
  if (!list.length) return
  const i = list.findIndex((s) => s.id === store.selectedId)
  const go = (n: number) => {
    const next = list[Math.max(0, Math.min(list.length - 1, n))]
    if (!next) return
    emit('select', next.id)
    void nextTick(() => document.querySelector(`[data-sid="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); go(i < 0 ? 0 : i - 1) }
  else if (e.key === 'Home') { e.preventDefault(); go(0) }
  else if (e.key === 'End') { e.preventDefault(); go(list.length - 1) }
  else if (e.key === 'F2' && list[i]) { e.preventDefault(); void startEdit(list[i]) }
}

// context menu
function openMenu(e: MouseEvent, s: SessionView) {
  emit('select', s.id)
  menu.value = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 220), s }
}
const closeMenu = () => { menu.value = null }
async function act(fn: () => unknown) { closeMenu(); await fn() }
async function copyPath(s: SessionView) {
  await window.echo.clipboard.write({ text: s.workingDirectory })
  notify('info', 'Path copied.', 2500)
}
async function toggleGlobalMute() { await window.echo.settings.save({ globalMute: !store.settings.globalMute }) }
async function openVscode(s: SessionView) { await window.echo.sessions.openInVscode({ id: s.id }) }
function onWindowKey(e: KeyboardEvent) { if (e.key === 'Escape') closeMenu() }
onMounted(() => { window.addEventListener('click', closeMenu); window.addEventListener('blur', closeMenu); window.addEventListener('keydown', onWindowKey) })
onBeforeUnmount(() => { window.removeEventListener('click', closeMenu); window.removeEventListener('blur', closeMenu); window.removeEventListener('keydown', onWindowKey) })
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="brand">Sessions</span>
      <span class="head-count">{{ totalCount }}</span>
      <span class="head-tools">
        <button class="tool-btn" :class="{ on: showArchived }" :aria-pressed="showArchived" title="Show archived sessions" aria-label="Show archived sessions" @click="showArchived = !showArchived">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 5.5h10v7.25H3zM2.25 3.25h11.5V5.5H2.25zM6.5 8h3" /></svg>
        </button>
        <button class="tool-btn" title="New session" aria-label="New session" @click="emit('create')">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.25v9.5M3.25 8h9.5" /></svg>
        </button>
      </span>
    </div>

    <label class="search-field">
      <svg class="search-icon" aria-hidden="true" viewBox="0 0 16 16"><circle cx="6.75" cy="6.75" r="4.25" /><path d="m10 10 3.25 3.25" /></svg>
      <input v-model="query" class="search" placeholder="Filter sessions" aria-label="Filter sessions" @keydown.esc="query = ''" />
      <button v-if="query" type="button" class="search-clear" title="Clear filter" aria-label="Clear filter" @click="query = ''">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>
      </button>
    </label>

    <div class="session-groups" role="listbox" aria-label="Sessions" tabindex="0" @keydown="onKey">
      <template v-for="group in groups" :key="group.name">
        <button class="group-title" type="button" :aria-expanded="!collapsed[group.name]" @click="collapsed[group.name] = !collapsed[group.name]">
          <svg class="chev" :class="{ collapsed: collapsed[group.name] }" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
          <span>{{ group.name }}</span><span class="count">{{ group.list.length }}</span>
        </button>
        <template v-if="!collapsed[group.name]">
          <div
            v-for="s in group.list" :key="s.id" class="session" role="option" :aria-selected="s.id === store.selectedId" :data-sid="s.id" :title="tip(s)"
            :class="{ selected: s.id === store.selectedId, attention: s.needsAttention, archived: !!s.archivedAt, closed: !s.running }"
            @click="emit('select', s.id)" @dblclick.stop="startEdit(s)" @contextmenu.prevent="openMenu($event, s)"
          >
            <i class="dot" :class="s.runtimeState.toLowerCase()"></i>
            <div class="session-main">
              <div class="session-line">
                <input v-if="editingId === s.id" ref="editInput" v-model="editText" class="rename" @click.stop @dblclick.stop @keydown.enter="commitEdit" @keydown.esc.stop="editingId = null" @blur="commitEdit" />
                <span v-else class="session-title">{{ s.title }}</span>
                <span v-if="s.speaking" class="speaking" title="Speaking"><span class="eq"><i></i><i></i><i></i></span></span>
                <svg v-else-if="s.muted" class="muted-icon" aria-label="Muted" viewBox="0 0 16 16"><path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11.5 6l3 4M14.5 6l-3 4" /></svg>
                <span class="session-time">{{ ago(s.lastActivityAt) }}</span>
                <span class="session-actions" @click.stop>
                  <button v-if="s.running" class="icon-btn small" title="Stop session (keeps history)" aria-label="Stop session" @click="close(s)">
                    <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
                  </button>
                  <button class="icon-btn small" :title="s.archivedAt ? 'Unarchive' : 'Archive'" :aria-label="s.archivedAt ? 'Unarchive session' : 'Archive session'" @click="archive(s)">
                    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 5.5h10v7.25H3zM2.25 3.25h11.5V5.5H2.25zM6.5 8h3" /></svg>
                  </button>
                </span>
              </div>
              <div class="session-sub">
                <span class="agent-tag" :class="s.agentType">{{ agentName(s) }}</span>
                <span class="path">{{ shortDir(s.workingDirectory) }}</span>
                <span class="session-state" :class="'s-' + s.runtimeState.toLowerCase()">{{ stateLabel[s.runtimeState] }}</span>
              </div>
            </div>
          </div>
        </template>
      </template>

      <div v-if="!filtered.length" class="empty-state">
        <template v-if="query || store.sessions.length">
          <strong>No matches</strong>
          <span>{{ query ? `Nothing matches “${query}”.` : 'All sessions are archived.' }}</span>
          <button v-if="query" class="btn small" @click="query = ''">Clear filter</button>
          <button v-else class="btn small" @click="showArchived = true">Show archived</button>
        </template>
        <template v-else>
          <strong>No sessions yet</strong>
          <span>Start Claude Code or Codex in a project folder.</span>
          <button class="btn primary small" @click="emit('create')">New session</button>
        </template>
      </div>
    </div>

    <div class="sidebar-foot">
      <span class="services">
        <span class="svc" :class="store.status.db ? 'ok' : 'bad'" :title="store.status.db ? 'MySQL connected' : 'MySQL unavailable (history is kept in memory only)'"><i></i>MySQL</span>
        <span class="svc" :class="store.status.stt ? 'ok' : 'bad'" :title="store.status.stt ? 'Speech-to-text ready' : 'Speech-to-text offline'"><i></i>STT</span>
        <span class="svc" :class="store.status.ttsReady ? 'ok' : store.status.tts ? 'warm' : 'bad'" :title="store.status.ttsReady ? 'Text-to-speech ready' : store.status.tts ? 'Text-to-speech is loading the model' : 'Text-to-speech offline'"><i></i>TTS<template v-if="store.status.tts && !store.status.ttsReady"> …</template></span>
      </span>
      <span class="foot-tools">
      <button class="tool-btn" :class="{ warn: store.settings.globalMute }" :aria-pressed="store.settings.globalMute" :title="store.settings.globalMute ? 'All voice output is muted. Click to unmute' : 'Mute all voice output'" aria-label="Mute all voice output" @click="toggleGlobalMute">
        <svg v-if="!store.settings.globalMute" aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 5.75a3.25 3.25 0 0 1 0 4.5" /></svg>
        <svg v-else aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 6.25v3.5h2.5L8.5 12.5v-9L5 6.25zM10.75 6l3 4M13.75 6l-3 4" /></svg>
      </button>
      <button class="tool-btn" title="Settings" aria-label="Settings" @click="emit('settings')">
        <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.25" /><path d="M8 1.75v1.6M8 12.65v1.6M1.75 8h1.6M12.65 8h1.6M3.6 3.6l1.15 1.15M11.25 11.25l1.15 1.15M3.6 12.4l1.15-1.15M11.25 4.75l1.15-1.15" /></svg>
      </button>
      </span>
    </div>

    <div v-if="menu" class="menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop @contextmenu.prevent>
      <button class="menu-item" role="menuitem" @click="act(() => startEdit(menu!.s))">Rename<kbd class="kbd">F2</kbd></button>
      <button v-if="menu.s.running" class="menu-item" role="menuitem" @click="act(() => close(menu!.s))">Stop session</button>
      <button class="menu-item" role="menuitem" @click="act(() => archive(menu!.s))">{{ menu.s.archivedAt ? 'Unarchive' : 'Archive' }}</button>
      <div class="menu-sep"></div>
      <button class="menu-item" role="menuitem" @click="act(() => copyPath(menu!.s))">Copy path</button>
      <button class="menu-item" role="menuitem" @click="act(() => openVscode(menu!.s))">Open in VS Code</button>
    </div>
  </aside>
</template>
