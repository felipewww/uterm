<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { AGENT_LABELS, type SessionView } from '@shared/types'
import { notify, store } from '../store'

const emit = defineEmits<{ select: [id: string]; create: []; settings: []; home: [] }>()
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
type Row =
  | { kind: 'folder'; key: string; id: string; name: string; depth: number; count: number }
  | { kind: 'new'; key: string; depth: number }
  | { kind: 'empty'; key: string; folderId: string; depth: number }
  | { kind: 'session'; key: string; s: SessionView; depth: number }
  | { kind: 'status'; key: string; name: string; count: number }
  | { kind: 'root-drop'; key: string }
type FolderRow = Extract<Row, { kind: 'folder' }>
const filtering = computed(() => !!query.value.trim())
const folderIds = computed(() => new Set(store.folders.map((f) => f.id)))
// A folder whose parent is unknown is shown at the top level.
const parentOf = (f: { parentId: string | null }) => (f.parentId && folderIds.value.has(f.parentId) ? f.parentId : null)
const childFolders = (pid: string | null) => store.folders.filter((f) => parentOf(f) === pid)
const sessionsIn = (fid: string) => filtered.value.filter((s) => s.folderId === fid)
const countIn = (fid: string): number => sessionsIn(fid).length + childFolders(fid).reduce((n, c) => n + countIn(c.id), 0)
/** `id` itself or anything below it. */
function isInside(candidate: string | null, id: string): boolean {
  for (let c = candidate, guard = 0; c && guard < 1000; guard++) {
    if (c === id) return true
    c = store.folders.find((f) => f.id === c)?.parentId ?? null
  }
  return false
}

const newFolder = ref<{ parentId: string | null; text: string } | null>(null) // a folder being named
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (pid: string | null, depth: number) => {
    if (newFolder.value && newFolder.value.parentId === pid) out.push({ kind: 'new', key: 'new', depth })
    for (const f of childFolders(pid)) {
      const count = countIn(f.id)
      if (filtering.value && !count) continue // while filtering, hide folders with no match
      out.push({ kind: 'folder', key: 'f:' + f.id, id: f.id, name: f.name, depth, count })
      if (collapsed['f:' + f.id]) continue
      walk(f.id, depth + 1)
      for (const s of sessionsIn(f.id)) out.push({ kind: 'session', key: s.id, s, depth: depth + 1 })
      if (!filtering.value && !childFolders(f.id).length && !sessionsIn(f.id).length && !(newFolder.value && newFolder.value.parentId === f.id)) out.push({ kind: 'empty', key: 'e:' + f.id, folderId: f.id, depth: depth + 1 })
    }
  }
  walk(null, 0)
  const loose = filtered.value.filter((s) => !s.folderId || !folderIds.value.has(s.folderId))
  for (const [name, list] of [['Active', loose.filter((s) => s.running)], ['Closed', loose.filter((s) => !s.running)]] as const) {
    if (!list.length) continue
    out.push({ kind: 'status', key: name, name, count: list.length })
    if (!collapsed[name]) for (const s of list) out.push({ kind: 'session', key: s.id, s, depth: 0 })
  }
  if (dragId.value) out.push({ kind: 'root-drop', key: 'root-drop' })
  return out
})
const visible = computed(() => rows.value.flatMap((r) => (r.kind === 'session' ? [r.s] : [])))

// folders: create / rename / delete / move
const editingFolder = ref<string | null>(null)
const folderText = ref('')
const folderInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)
const folderMenu = ref<{ x: number; y: number; id: string; name: string } | null>(null)
async function focusFolderInput() {
  await nextTick()
  const el = Array.isArray(folderInput.value) ? folderInput.value[0] : folderInput.value
  el?.focus(); el?.select()
}
async function startNewFolder(parentId: string | null = null) {
  if (parentId) collapsed['f:' + parentId] = false
  newFolder.value = { parentId, text: '' }
  await focusFolderInput()
}
async function commitNewFolder() {
  const n = newFolder.value
  newFolder.value = null
  if (n?.text.trim()) await window.echo.folders.create({ name: n.text.trim(), parentId: n.parentId })
}
async function startRenameFolder(id: string, name: string) { editingFolder.value = id; folderText.value = name; await focusFolderInput() }
async function commitRenameFolder() {
  const id = editingFolder.value
  editingFolder.value = null
  if (id && folderText.value.trim()) await window.echo.folders.rename({ id, name: folderText.value.trim() })
}
async function deleteFolder(id: string) { await window.echo.folders.remove({ id }) }
async function moveFolder(id: string, parentId: string | null) {
  if (isInside(parentId, id)) return
  if (parentId) collapsed['f:' + parentId] = false
  await window.echo.folders.move({ id, parentId })
}
async function moveTo(s: SessionView, folderId: string | null) {
  if (s.folderId === folderId) return
  if (folderId) collapsed['f:' + folderId] = false
  await window.echo.sessions.moveToFolder({ id: s.id, folderId })
}
async function moveToNewFolder(s: SessionView) {
  const f = await window.echo.folders.create({ name: 'New folder' }) as { id: string } | undefined
  if (!f) return
  await moveTo(s, f.id)
  await startRenameFolder(f.id, 'New folder')
}
/** Folders in tree order with their depth, for the "Move to" menus. `exclude` hides a folder and its subtree. */
function folderOptions(exclude: string | null = null): Array<{ id: string; name: string; depth: number }> {
  const out: Array<{ id: string; name: string; depth: number }> = []
  const walk = (pid: string | null, depth: number) => {
    for (const f of childFolders(pid)) {
      if (f.id === exclude) continue
      out.push({ id: f.id, name: f.name, depth }); walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

// drag & drop: sessions and folders onto a folder, or onto Active/Closed/the bottom strip (top level)
const dragId = ref<string | null>(null)
const dragKind = ref<'session' | 'folder' | null>(null)
const dropKey = ref<string | null>(null)
function onDragStart(e: DragEvent, kind: 'session' | 'folder', id: string) {
  dragId.value = id; dragKind.value = kind
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragEnd() { dragId.value = null; dragKind.value = null; dropKey.value = null }
function onDragOver(e: DragEvent, key: string, folderId: string | null) {
  if (!dragId.value) return
  if (dragKind.value === 'folder' && isInside(folderId, dragId.value)) return // no drop onto itself or its own subfolder
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropKey.value = key
}
async function onDrop(e: DragEvent, folderId: string | null) {
  e.preventDefault()
  const id = dragId.value; const kind = dragKind.value
  onDragEnd()
  if (!id) return
  if (kind === 'folder') await moveFolder(id, folderId)
  else { const s = store.sessions.find((x) => x.id === id); if (s) await moveTo(s, folderId) }
}
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
const agentName = (s: SessionView) => AGENT_LABELS[s.agentType].short
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
  folderMenu.value = null
  menu.value = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), s }
}
function openFolderMenu(e: MouseEvent, f: FolderRow) {
  menu.value = null
  folderMenu.value = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), id: f.id, name: f.name }
}
const closeMenu = () => { menu.value = null; folderMenu.value = null }
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
        <button class="tool-btn" :class="{ on: !store.selectedId }" title="Home" aria-label="Home" @click="emit('home')">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 7.75 8 3l5.5 4.75M4 6.75V13h8V6.75M6.75 13V9.75h2.5V13" /></svg>
        </button>
        <button class="tool-btn" :class="{ on: showArchived }" :aria-pressed="showArchived" title="Show archived sessions" aria-label="Show archived sessions" @click="showArchived = !showArchived">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 5.5h10v7.25H3zM2.25 3.25h11.5V5.5H2.25zM6.5 8h3" /></svg>
        </button>
        <button class="tool-btn" title="New folder" aria-label="New folder" @click="startNewFolder(null)">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.25h4l1.5 1.75H14v6.5H2zM8 8v3M6.5 9.5h3" /></svg>
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
      <template v-for="row in rows" :key="row.key">
        <!-- folder -->
        <div
          v-if="row.kind === 'folder'" class="group-title folder" :class="{ 'drop-target': dropKey === row.key, dragging: dragId === row.id }" :style="{ '--depth': row.depth }"
          role="button" tabindex="-1" :aria-expanded="!collapsed[row.key]" :draggable="editingFolder !== row.id"
          @click="collapsed[row.key] = !collapsed[row.key]" @contextmenu.prevent="openFolderMenu($event, row)" @dblclick.stop="startRenameFolder(row.id, row.name)"
          @dragstart="onDragStart($event, 'folder', row.id)" @dragend="onDragEnd" @dragover="onDragOver($event, row.key, row.id)" @dragleave="dropKey = null" @drop="onDrop($event, row.id)"
        >
          <svg class="chev" :class="{ collapsed: collapsed[row.key] }" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
          <svg class="folder-ico" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.25h4l1.5 1.75H14v6.5H2z" /></svg>
          <input v-if="editingFolder === row.id" ref="folderInput" v-model="folderText" class="rename" aria-label="Folder name" @click.stop @dblclick.stop @keydown.enter="commitRenameFolder" @keydown.esc.stop="editingFolder = null" @blur="commitRenameFolder" />
          <span v-else class="group-name">{{ row.name }}</span><span class="count">{{ row.count }}</span>
        </div>

        <!-- folder being named -->
        <div v-else-if="row.kind === 'new' && newFolder" class="group-title folder" :style="{ '--depth': row.depth }">
          <svg class="chev" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
          <svg class="folder-ico" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.25h4l1.5 1.75H14v6.5H2z" /></svg>
          <input ref="folderInput" v-model="newFolder.text" class="rename" placeholder="Folder name" aria-label="New folder name" @keydown.enter="commitNewFolder" @keydown.esc.stop="newFolder = null" @blur="commitNewFolder" />
        </div>

        <div v-else-if="row.kind === 'empty'" class="folder-empty" :class="{ 'drop-target': dropKey === row.key }" :style="{ '--depth': row.depth }" @dragover="onDragOver($event, row.key, row.folderId)" @dragleave="dropKey = null" @drop="onDrop($event, row.folderId)">Empty. Drag items here.</div>

        <!-- Active / Closed (also the "top level" drop target) -->
        <div
          v-else-if="row.kind === 'status'" class="group-title status" :class="{ 'drop-target': dropKey === row.key }" role="button" tabindex="-1" :aria-expanded="!collapsed[row.key]"
          @click="collapsed[row.key] = !collapsed[row.key]" @dragover="onDragOver($event, row.key, null)" @dragleave="dropKey = null" @drop="onDrop($event, null)"
        >
          <svg class="chev" :class="{ collapsed: collapsed[row.key] }" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
          <span class="group-name">{{ row.name }}</span><span class="count">{{ row.count }}</span>
        </div>

        <div v-else-if="row.kind === 'root-drop'" class="root-drop" :class="{ 'drop-target': dropKey === row.key }" @dragover="onDragOver($event, row.key, null)" @dragleave="dropKey = null" @drop="onDrop($event, null)">Drop here for top level</div>

        <!-- session -->
        <div
          v-else-if="row.kind === 'session'" class="session" draggable="true" role="option" :aria-selected="row.s.id === store.selectedId" :data-sid="row.s.id" :title="tip(row.s)" :style="{ '--depth': row.depth }"
          :class="{ 'in-folder': row.depth > 0, dragging: dragId === row.s.id, selected: row.s.id === store.selectedId, attention: row.s.needsAttention, archived: !!row.s.archivedAt, closed: !row.s.running }"
          @click="emit('select', row.s.id)" @dblclick.stop="startEdit(row.s)" @dragstart="onDragStart($event, 'session', row.s.id)" @dragend="onDragEnd" @contextmenu.prevent="openMenu($event, row.s)"
        >
          <i class="dot" :class="row.s.runtimeState.toLowerCase()"></i>
          <div class="session-main">
            <div class="session-line">
              <input v-if="editingId === row.s.id" ref="editInput" v-model="editText" class="rename" @click.stop @dblclick.stop @keydown.enter="commitEdit" @keydown.esc.stop="editingId = null" @blur="commitEdit" />
              <span v-else class="session-title">{{ row.s.title }}</span>
              <span v-if="row.s.speaking" class="speaking" title="Speaking"><span class="eq"><i></i><i></i><i></i></span></span>
              <svg v-else-if="row.s.muted" class="muted-icon" aria-label="Muted" viewBox="0 0 16 16"><path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11.5 6l3 4M14.5 6l-3 4" /></svg>
              <span class="session-time">{{ ago(row.s.lastActivityAt) }}</span>
              <span class="session-actions" @click.stop>
                <button v-if="row.s.running" class="icon-btn small" title="Stop session (keeps history)" aria-label="Stop session" @click="close(row.s)">
                  <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
                </button>
                <button class="icon-btn small" :title="row.s.archivedAt ? 'Unarchive' : 'Archive'" :aria-label="row.s.archivedAt ? 'Unarchive session' : 'Archive session'" @click="archive(row.s)">
                  <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 5.5h10v7.25H3zM2.25 3.25h11.5V5.5H2.25zM6.5 8h3" /></svg>
                </button>
              </span>
            </div>
            <div class="session-sub">
              <span class="agent-tag" :class="row.s.agentType">{{ agentName(row.s) }}</span>
              <span class="path">{{ shortDir(row.s.workingDirectory) }}</span>
              <span class="session-state" :class="'s-' + row.s.runtimeState.toLowerCase()">{{ stateLabel[row.s.runtimeState] }}</span>
            </div>
          </div>
        </div>
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
      <div class="menu-label">Move to folder</div>
      <button v-for="f in folderOptions()" :key="f.id" class="menu-item" role="menuitem" :style="{ paddingLeft: 10 + f.depth * 12 + 'px' }" @click="act(() => moveTo(menu!.s, f.id))">{{ f.name }}<span v-if="menu.s.folderId === f.id" class="menu-check">✓</span></button>
      <button class="menu-item" role="menuitem" @click="act(() => moveToNewFolder(menu!.s))">New folder…</button>
      <button v-if="menu.s.folderId" class="menu-item" role="menuitem" @click="act(() => moveTo(menu!.s, null))">Remove from folder</button>
      <div class="menu-sep"></div>
      <button class="menu-item" role="menuitem" @click="act(() => copyPath(menu!.s))">Copy path</button>
      <button class="menu-item" role="menuitem" @click="act(() => openVscode(menu!.s))">Open in VS Code</button>
    </div>
    <div v-if="folderMenu" class="menu" role="menu" :style="{ left: folderMenu.x + 'px', top: folderMenu.y + 'px' }" @click.stop @contextmenu.prevent>
      <button class="menu-item" role="menuitem" @click="act(() => startNewFolder(folderMenu!.id))">New subfolder</button>
      <button class="menu-item" role="menuitem" @click="act(() => startRenameFolder(folderMenu!.id, folderMenu!.name))">Rename folder</button>
      <div class="menu-sep"></div>
      <div class="menu-label">Move folder to</div>
      <button class="menu-item" role="menuitem" @click="act(() => moveFolder(folderMenu!.id, null))">Top level</button>
      <button v-for="f in folderOptions(folderMenu.id)" :key="f.id" class="menu-item" role="menuitem" :style="{ paddingLeft: 10 + f.depth * 12 + 'px' }" @click="act(() => moveFolder(folderMenu!.id, f.id))">{{ f.name }}</button>
      <div class="menu-sep"></div>
      <button class="menu-item" role="menuitem" @click="act(() => deleteFolder(folderMenu!.id))">Delete folder (contents move up)</button>
    </div>
  </aside>
</template>
