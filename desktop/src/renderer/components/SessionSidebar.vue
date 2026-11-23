<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref } from 'vue'
import { AGENT_LABELS, type SessionView } from '@shared/types'
import { parseVoiceId } from '@shared/voices'
import { notify, selected, store, usd, voiceOf } from '../store'
import SidebarNodes from './SidebarNodes.vue'
import type { SidebarNode } from './sidebarTypes'

const emit = defineEmits<{ select: [id: string]; create: []; settings: [pane?: string]; usage: [] }>()
const query = ref('')
// Folders start collapsed: only an explicit `false` means open. (While filtering, matching folders are shown open so results are never hidden.)
const collapsed = reactive<Record<string, boolean>>({})
const editingId = ref<string | null>(null)
const editText = ref('')
const menu = ref<{ x: number; y: number; s: SessionView } | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.sessions
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.workingDirectory.toLowerCase().includes(q) || s.agentType.includes(q))
})
const filtering = computed(() => !!query.value.trim())
const folderIds = computed(() => new Set(store.folders.map((f) => f.id)))
// A folder whose parent is unknown is shown at the top level.
const parentOf = (f: { parentId: string | null }) => (f.parentId && folderIds.value.has(f.parentId) ? f.parentId : null)
const childFolders = (pid: string | null) => store.folders.filter((f) => parentOf(f) === pid)
// Running sessions come first (the list is already newest-first, and the sort is stable).
const liveFirst = (list: SessionView[]) => [...list].sort((a, b) => Number(b.running) - Number(a.running))
const sessionsIn = (fid: string) => liveFirst(filtered.value.filter((s) => s.folderId === fid))
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
const tree = computed<SidebarNode[]>(() => {
  const build = (pid: string | null): SidebarNode[] => {
    const out: SidebarNode[] = []
    if (newFolder.value && newFolder.value.parentId === pid) out.push({ kind: 'new', key: 'new', parentId: pid })
    for (const f of childFolders(pid)) {
      const count = countIn(f.id)
      if (filtering.value && !count) continue // while filtering, hide folders with no match
      const key = 'f:' + f.id
      const isCollapsed = !filtering.value && collapsed[key] !== false
      const children: SidebarNode[] = isCollapsed ? [] : [...build(f.id), ...sessionsIn(f.id).map((s): SidebarNode => ({ kind: 'session', key: s.id, s }))]
      if (!isCollapsed && !filtering.value && children.length === 0) children.push({ kind: 'empty', key: 'e:' + f.id, folderId: f.id })
      out.push({ kind: 'folder', key, id: f.id, name: f.name, count, collapsed: isCollapsed, children })
    }
    return out
  }
  return build(null)
})
const loose = computed(() => liveFirst(filtered.value.filter((s) => !s.folderId || !folderIds.value.has(s.folderId))))
const looseNodes = computed<SidebarNode[]>(() => loose.value.map((s): SidebarNode => ({ kind: 'session', key: s.id, s })))
const visible = computed(() => {
  const out: SessionView[] = []
  const walk = (ns: SidebarNode[]) => { for (const n of ns) { if (n.kind === 'folder') walk(n.children); else if (n.kind === 'session') out.push(n.s) } }
  walk(tree.value); out.push(...loose.value)
  return out
})

// folders: create / rename / delete / move
const editingFolder = ref<string | null>(null)
const folderText = ref('')
const folderMenu = ref<{ x: number; y: number; id: string; name: string } | null>(null)
async function focusFolderInput() {
  await nextTick()
  const el = document.querySelector<HTMLInputElement>('.sb-folder-input')
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
// STT/TTS chips show what is in use: for TTS the voice of the selected chat (else the default voice), for STT the chosen transcriber.
// A click opens Settings → Voice engines.
const ttsProvider = computed(() => parseVoiceId(voiceOf(selected())).provider)
const provider = (n: 'stt' | 'tts') => (n === 'stt' ? store.settings.sttProvider : ttsProvider.value)
const cloud = (n: 'stt' | 'tts') => provider(n) !== 'local'
const cloudReady = (n: 'stt' | 'tts') => { const p = provider(n); return p !== 'local' && store.keys[p] }
const chatterbox = computed(() => store.settings.ttsEngine === 'chatterbox')
// The dot says whether that engine can work right now; the cloud mark says a cloud provider is in use.
const svcClass = (n: 'stt' | 'tts') => {
  if (cloud(n)) return cloudReady(n) ? 'ok' : 'bad'
  if (n === 'tts') return chatterbox.value ? (store.status.ttsReady ? 'ok' : store.status.tts ? 'warm' : 'bad') : store.status.systemVoice ? 'ok' : 'bad'
  return store.status.stt ? 'ok' : 'bad'
}
const engineName = (n: 'stt' | 'tts') => {
  const p = provider(n)
  if (p !== 'local') return p === 'openai' ? 'OpenAI (cloud)' : 'Google Gemini (cloud)'
  return n === 'stt' ? 'Whisper built into the app' : chatterbox.value ? 'Chatterbox server' : 'the system voice'
}
const svcTitle = (n: 'stt' | 'tts') => {
  const name = n === 'stt' ? 'Speech-to-text' : 'Text-to-speech'
  const state = svcClass(n) === 'ok' ? 'ready' : svcClass(n) === 'warm' ? 'loading' : cloud(n) ? 'API key missing' : 'unavailable'
  return `${name}: ${engineName(n)}, ${state}. Click to choose the engine`
}
// expand / collapse every folder at once: if any is open the button collapses all, otherwise it opens all
const anyOpen = computed(() => store.folders.some((f) => collapsed['f:' + f.id] === false))
function toggleAllFolders() { const close = anyOpen.value; for (const f of store.folders) collapsed['f:' + f.id] = close }
const liveCount = computed(() => store.sessions.filter((s) => s.running).length)
const totalCount = computed(() => store.sessions.length)

const stateLabel: Record<string, string> = {
  STARTING: 'Starting', IDLE: 'Ready', WORKING: 'Working', WAITING_FOR_INPUT: 'Needs input',
  WAITING_FOR_PERMISSION: 'Permission', ERROR: 'Error', CLOSED: 'Closed'
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
// A non-default Claude account is shown next to the agent name: ~/.claude-me -> "Claude (me)".
const agentName = (s: SessionView) => AGENT_LABELS[s.agentType].short + (s.configDir ? ` (${s.configDir.split('/').filter(Boolean).pop()?.replace(/^\.claude[-_.]?/, '') || 'alt'})` : '')
/** Only what deserves a word: a calm session says nothing. */
const statusText = (s: SessionView) => (!s.running ? '' : ({ WORKING: 'Working', STARTING: 'Starting', WAITING_FOR_INPUT: 'Needs input', WAITING_FOR_PERMISSION: 'Needs approval', ERROR: 'Error' } as Record<string, string>)[s.runtimeState] ?? '')
const statusTone = (s: SessionView) => (s.runtimeState === 'ERROR' ? 'bad' : s.runtimeState.startsWith('WAITING') ? 'warn' : '')
const tip = (s: SessionView) => `${s.title}\n${agentName(s)} · ${s.workingDirectory}\n${stateLabel[s.runtimeState]}${s.muted ? ' · muted' : ''}`

async function startEdit(s: SessionView) {
  editingId.value = s.id; editText.value = s.title
  await nextTick()
  const el = document.querySelector<HTMLInputElement>('.sb-edit-input')
  el?.focus(); el?.select()
}
async function commitEdit() {
  const id = editingId.value
  editingId.value = null
  if (id && editText.value.trim()) await window.echo.sessions.rename({ id, title: editText.value.trim() })
}
async function close(s: SessionView) { await window.echo.sessions.stop({ id: s.id }) }

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
  else if (e.key === 'Delete' && list[i]) { e.preventDefault(); store.confirmDelete = list[i]! }
  else if (e.key === 'F2' && list[i]) { e.preventDefault(); void startEdit(list[i]) }
}

// context menu
function openMenu(e: MouseEvent, s: SessionView) {
  emit('select', s.id)
  folderMenu.value = null
  menu.value = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), s }
}
function openFolderMenu(e: MouseEvent, f: { id: string; name: string }) {
  menu.value = null
  folderMenu.value = { x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300), id: f.id, name: f.name }
}
const closeMenu = () => { menu.value = null; folderMenu.value = null }
// Run the action first: its arguments read the open menu's target (`menu!.s`), which closeMenu() clears.
async function act(fn: () => unknown) { const done = fn(); closeMenu(); await done }
async function copyPath(s: SessionView) {
  await window.echo.clipboard.write({ text: s.workingDirectory })
  notify('info', 'Path copied.', 2500)
}
async function toggleGlobalMute() { await window.echo.settings.save({ globalMute: !store.settings.globalMute }) }
async function openVscode(s: SessionView) { await window.echo.sessions.openInVscode({ id: s.id }) }
function onWindowKey(e: KeyboardEvent) { if (e.key === 'Escape') closeMenu() }
provide('sbx', reactive({
  collapsed, dragId, dropKey, editingFolder, folderText, newFolder, editingId, editText,
  startRenameFolder, commitRenameFolder, commitNewFolder, openFolderMenu, onDragStart, onDragOver, onDragEnd, onDrop,
  select: (id: string) => emit('select', id), startEdit, commitEdit, openMenu, close, remove: (s: SessionView) => { store.confirmDelete = s }, ago, shortDir, agentName, tip, statusText, statusTone
}))
onMounted(() => { window.addEventListener('click', closeMenu); window.addEventListener('blur', closeMenu); window.addEventListener('keydown', onWindowKey) })
onBeforeUnmount(() => { window.removeEventListener('click', closeMenu); window.removeEventListener('blur', closeMenu); window.removeEventListener('keydown', onWindowKey) })
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="brand">Sessions</span>
      <span class="head-count">{{ totalCount }}</span>
      <span v-if="liveCount" class="head-live" :title="`${liveCount} running`"><i></i>{{ liveCount }} live</span>
      <span class="head-tools">
        <button v-if="store.folders.length" class="tool-btn" :title="anyOpen ? 'Collapse all folders' : 'Expand all folders'" :aria-label="anyOpen ? 'Collapse all folders' : 'Expand all folders'" @click="toggleAllFolders">
          <svg v-if="anyOpen" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 3.5 3.5 3.5 3.5-3.5M4.5 12.5 8 9l3.5 3.5" /></svg>
          <svg v-else aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 7 3.5-3.5L11.5 7M4.5 9 8 12.5 11.5 9" /></svg>
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
      <div class="sb-list">
        <SidebarNodes :nodes="tree" />
        <div v-if="loose.length" class="sb-loose" :class="{ spaced: tree.length }"><SidebarNodes :nodes="looseNodes" /></div>
        <div v-if="dragId" class="root-drop" :class="{ 'drop-target': dropKey === 'root-drop' }" @dragover="onDragOver($event, 'root-drop', null)" @dragleave="dropKey = null" @drop="onDrop($event, null)">Drop here for top level</div>
      </div>

      <div v-if="!filtered.length" class="empty-state">
        <template v-if="query || store.sessions.length">
          <strong>No matches</strong>
          <span>Nothing matches “{{ query }}”.</span>
          <button class="btn small" @click="query = ''">Clear filter</button>
        </template>
        <template v-else>
          <strong>No sessions yet</strong>
          <span>Start Claude Code or Codex in a project folder.</span>
          <button class="btn primary small" @click="emit('create')">New session</button>
        </template>
      </div>
    </div>

    <button class="usage-chip" :title="`Estimated cloud spend: ${usd(store.spend.today)} today, ${usd(store.spend.month)} this month, ${usd(store.spend.all)} in total. Click for details`" @click="emit('usage')">
      <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4.5 12.5h7a2.75 2.75 0 0 0 .4-5.47A3.75 3.75 0 0 0 4.7 6.2 3.15 3.15 0 0 0 4.5 12.5z" /></svg>
      <span>Cloud usage</span><strong>{{ usd(store.spend.month) }}</strong><small>this month</small>
    </button>
    <div class="sidebar-foot">
      <span class="services">
        <span v-if="!store.status.db" class="svc bad" title="The local database could not be opened: history is kept in memory only"><i></i>No database</span>
        <button class="svc" :class="svcClass('stt')" :title="svcTitle('stt')" @click="emit('settings', 'engines')"><i></i>STT<svg v-if="cloud('stt')" class="cloud-mark" :class="cloudReady('stt') ? 'ok' : 'bad'" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 12.5h7a2.75 2.75 0 0 0 .4-5.47A3.75 3.75 0 0 0 4.7 6.2 3.15 3.15 0 0 0 4.5 12.5z" /></svg></button>
        <button class="svc" :class="svcClass('tts')" :title="svcTitle('tts')" @click="emit('settings', 'engines')"><i></i>TTS<svg v-if="cloud('tts')" class="cloud-mark" :class="cloudReady('tts') ? 'ok' : 'bad'" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 12.5h7a2.75 2.75 0 0 0 .4-5.47A3.75 3.75 0 0 0 4.7 6.2 3.15 3.15 0 0 0 4.5 12.5z" /></svg></button>
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
      <div class="menu-sep"></div>
      <div class="menu-label">Move to folder</div>
      <button v-for="f in folderOptions()" :key="f.id" class="menu-item" role="menuitem" :style="{ paddingLeft: 10 + f.depth * 12 + 'px' }" @click="act(() => moveTo(menu!.s, f.id))">{{ f.name }}<span v-if="menu.s.folderId === f.id" class="menu-check">✓</span></button>
      <button class="menu-item" role="menuitem" @click="act(() => moveToNewFolder(menu!.s))">New folder…</button>
      <button v-if="menu.s.folderId" class="menu-item" role="menuitem" @click="act(() => moveTo(menu!.s, null))">Remove from folder</button>
      <div class="menu-sep"></div>
      <button class="menu-item" role="menuitem" @click="act(() => copyPath(menu!.s))">Copy path</button>
      <button class="menu-item" role="menuitem" @click="act(() => openVscode(menu!.s))">Open in VS Code</button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" role="menuitem" @click="act(() => { store.confirmDelete = menu!.s })">Delete<kbd class="kbd">Del</kbd></button>
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
