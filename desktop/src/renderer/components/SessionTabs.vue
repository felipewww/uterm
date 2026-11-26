<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AGENT_LABELS, type SessionView } from '@shared/types'
import { newTerminal, store } from '../store'
import { applyOrder, groupTabs, moveTab } from '../tabOrder'
import AgentIcon from './AgentIcon.vue'

/**
 * Every open terminal as a tab along the top, like the files open in VS Code. Tabs appear when an agent starts, in the order
 * they were opened, and go away when it stops. The selected session always has a tab (an italic "preview" tab when it is closed).
 */
const emit = defineEmits<{ select: [id: string | null] }>()

const openedAt = reactive<Record<string, number>>({})
let tick = 0
watch(() => store.sessions.map((s) => `${s.id}:${s.running}`).join('|'), () => {
  for (const s of store.sessions) {
    if (s.running && store.restoredTabs.includes(s.id)) store.restoredTabs = store.restoredTabs.filter((x) => x !== s.id) // resumed: a normal tab from now on
    if (s.running && !(s.id in openedAt)) openedAt[s.id] = ++tick
    else if (!s.running && !(s.id === store.selectedId)) delete openedAt[s.id]
  }
}, { immediate: true })

// Order: the one you dragged them into (remembered), newcomers at the end.
const ORDER_KEY = 'echo-term.tab-order.v1'
const order = ref<string[]>((() => { try { const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] } })())
watch(order, (o) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(o.slice(-60))) } catch { /* storage unavailable */ } }, { deep: true })

const isTab = (s: SessionView) => s.running || store.restoredTabs.includes(s.id)
const tabs = computed(() => {
  const natural = store.sessions.filter(isTab).sort((a, b) => (openedAt[a.id] ?? 0) - (openedAt[b.id] ?? 0))
  const open = applyOrder(natural, order.value)
  const sel = store.sessions.find((s) => s.id === store.selectedId)
  return sel && !isTab(sel) ? [...open, sel] : open
})

// Tab groups, like Chrome's: the user makes them here and puts any terminals inside. Colored label + colored tabs; clicking the label hides or shows them.
const GROUPS_KEY = 'echo-term.tab-groups.v2'
const COLORS = [ // bright tones of our own: on the tab strip they are only a soft light from a corner, so they need to be vivid
  { id: 'blue', css: '#3b9dff' }, { id: 'green', css: '#14d99a' }, { id: 'amber', css: '#ffc41f' },
  { id: 'orange', css: '#ff8130' }, { id: 'violet', css: '#9d6bff' }, { id: 'red', css: '#ff4d73' }
]
const colorCss = (id: string) => COLORS.find((c) => c.id === id)?.css ?? COLORS[0]!.css
interface TabGroup { id: string; name: string; color: string }
const gs = reactive<{ groups: TabGroup[]; members: Record<string, string>; hidden: Record<string, boolean> }>((() => {
  try { const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? 'null'); if (v && Array.isArray(v.groups) && v.members && v.hidden) return v } catch { /* start empty */ }
  return { groups: [], members: {}, hidden: {} }
})())
watch(gs, (v) => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(v)) } catch { /* storage unavailable */ } }, { deep: true })
const groupOfTab = (s: SessionView) => { const g = gs.members[s.id]; return g && gs.groups.some((x) => x.id === g) ? g : null }
const grouped = computed(() => groupTabs(tabs.value, groupOfTab))
const groupById = (id: string) => gs.groups.find((g) => g.id === id)!
// The strip as one flat list (a group's label, then its tabs unless folded), so each cell can animate in and out on its own.
const cells = computed(() => grouped.value.flatMap((g) => [
  ...(g.group ? [{ key: `group:${g.group}`, g, s: null as SessionView | null }] : []),
  ...(!g.group || !gs.hidden[g.group] ? g.tabs.map((s) => ({ key: s.id, g, s: s as SessionView | null })) : [])
]))
// forget sessions that no longer exist, and groups nobody is in
watch(() => store.sessions.map((x) => x.id).join('|'), () => {
  const ids = new Set(store.sessions.map((x) => x.id))
  for (const k of Object.keys(gs.members)) if (!ids.has(k)) delete gs.members[k]
  const used = new Set(Object.values(gs.members))
  gs.groups = gs.groups.filter((g) => used.has(g.id))
})
// selecting a tab inside a hidden group (from the list, a notification…) shows the group again
watch(() => store.selectedId, (id) => { const g = id ? gs.members[id] : null; if (g && gs.hidden[g]) gs.hidden[g] = false })
function newGroupWith(s: SessionView) {
  const id = crypto.randomUUID()
  gs.groups.push({ id, name: `Group ${gs.groups.length + 1}`, color: COLORS[gs.groups.length % COLORS.length]!.id })
  gs.members[s.id] = id
  editing.value = id; editText.value = groupById(id).name
  void nextTick(() => (document.querySelector('.tab-group-input') as HTMLInputElement | null)?.select())
}
const addTo = (s: SessionView, g: string) => { gs.members[s.id] = g }
const removeFromGroup = (s: SessionView) => { delete gs.members[s.id] }
function ungroup(g: string) { for (const k of Object.keys(gs.members)) if (gs.members[k] === g) delete gs.members[k]; gs.groups = gs.groups.filter((x) => x.id !== g) }
const editing = ref<string | null>(null)
const editText = ref('')
function commitName() { const g = editing.value; editing.value = null; if (g && editText.value.trim() && gs.groups.some((x) => x.id === g)) groupById(g).name = editText.value.trim().slice(0, 40) }
function startRename(g: string) { editing.value = g; editText.value = groupById(g).name; void nextTick(() => (document.querySelector('.tab-group-input') as HTMLInputElement | null)?.select()) }

// right-click menus
const tabMenu = ref<{ x: number; y: number; s: SessionView } | null>(null)
const groupMenu = ref<{ x: number; y: number; id: string } | null>(null)
const closeMenus = () => { tabMenu.value = null; groupMenu.value = null }
const at = (e: MouseEvent) => ({ x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 260) })
function openTabMenu(e: MouseEvent, s: SessionView) { groupMenu.value = null; tabMenu.value = { ...at(e), s } }
function openGroupMenu(e: MouseEvent, id: string) { tabMenu.value = null; groupMenu.value = { ...at(e), id } }
function act(fn: () => void) { fn(); closeMenus() }
onMounted(() => { window.addEventListener('click', closeMenus); window.addEventListener('blur', closeMenus) })
onBeforeUnmount(() => { window.removeEventListener('click', closeMenus); window.removeEventListener('blur', closeMenus) })

/** What a tab asks of you: answer a question, approve something, look at an error, or just see that it finished. */
const flag = (s: SessionView): { kind: 'answer' | 'approve' | 'error' | 'done'; text: string } | null => {
  if (!s.running) return null
  if (s.runtimeState === 'WAITING_FOR_INPUT') return { kind: 'answer', text: 'Answer' }
  if (s.runtimeState === 'WAITING_FOR_PERMISSION') return { kind: 'approve', text: 'Approve' }
  if (s.runtimeState === 'ERROR') return { kind: 'error', text: 'Error' }
  if (s.needsAttention && s.runtimeState === 'IDLE') return { kind: 'done', text: 'Done' } // finished while you were elsewhere; clears when you open it
  return null
}
const waiting = computed(() => tabs.value.filter((s) => s.id !== store.selectedId && ['answer', 'approve', 'error'].includes(flag(s)?.kind ?? '')))
const label = (s: SessionView) => AGENT_LABELS[s.agentType].short
const tip = (s: SessionView) => `${s.title}\n${label(s)} · ${s.workingDirectory}${s.running ? '' : '\nClosed. Resume it from the card below'}`

// drag and drop: drop on the left half of a tab to go before it, on the right half to go after it
const dragId = ref<string | null>(null)
const drop = ref<{ id: string; after: boolean } | null>(null)
function onDragStart(e: DragEvent, s: SessionView) {
  e.dataTransfer?.setData('text/plain', s.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  // Mark it as dragged only after the browser has taken its drag image: changing the dragged element during dragstart can cancel the drag,
  // and agent tabs re-render constantly (state, speaking, flags) while a terminal's never does.
  setTimeout(() => { dragId.value = s.id }, 0)
}
function onDragOver(e: DragEvent, s: SessionView) {
  if (!dragId.value || !isTab(s)) return
  e.preventDefault() // accept the drop everywhere on a tab (also on itself), so the drag is never refused mid-way
  if (dragId.value === s.id) { drop.value = null; return }
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  drop.value = { id: s.id, after: e.clientX > r.left + r.width / 2 }
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  const d = drop.value; const id = dragId.value
  onDragEnd()
  if (!d || !id) return
  const current = tabs.value.filter(isTab).map((t) => t.id) // materialise what is on screen, then move
  order.value = moveTab(current, id, d.id, d.after)
  const target = tabs.value.find((t) => t.id === d.id)
  const g = target ? groupOfTab(target) : null // like Chrome: dropping between tabs joins (or leaves) the group of its neighbour
  if (g) gs.members[id] = g; else delete gs.members[id]
}
function onDropOnGroup(e: DragEvent, g: string) { e.preventDefault(); const id = dragId.value; onDragEnd(); if (id) { gs.members[id] = g; gs.hidden[g] = false } }
function onDragEnd() { dragId.value = null; drop.value = null }
async function openTerminal() { const id = await newTerminal(); if (id) emit('select', id) }
async function close(s: SessionView) {
  const list = tabs.value
  const i = list.findIndex((t) => t.id === s.id)
  store.restoredTabs = store.restoredTabs.filter((x) => x !== s.id)
  if (s.running) await window.echo.sessions.stop({ id: s.id })
  if (s.id === store.selectedId) { // like closing the active file: land on its neighbour, or on Home
    const next = list.filter((t) => t.id !== s.id && isTab(t))[Math.min(i, list.length - 2)]
    emit('select', next?.id ?? null)
  }
}
// The strip scrolls; Home, the arrows, "needs you" and "new terminal" stay put at its ends.
const strip = ref<HTMLElement | null>(null)
const more = reactive({ left: false, right: false })
function measure() {
  const el = strip.value
  if (!el) return
  more.left = el.scrollLeft > 1
  more.right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
function onWheel(e: WheelEvent) { // vertical wheel scrolls the strip sideways
  const el = strip.value
  if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1); e.preventDefault() }
}
const page = (dir: -1 | 1) => strip.value?.scrollBy({ left: dir * Math.max(160, strip.value.clientWidth * 0.7), behavior: 'smooth' })
/** Scrolls a tab into view, together with its group's label when it is the first of the group (that label is how the group is folded). */
function reveal(id: string) {
  const box = strip.value
  const tab = box?.querySelector<HTMLElement>(`[data-tab="${id}"]`)
  if (!box || !tab) return
  const before = tab.previousElementSibling as HTMLElement | null
  const lead = before?.classList.contains('tab-group') ? before : tab
  if (lead.offsetLeft - 8 < box.scrollLeft) box.scrollLeft = lead.offsetLeft - 8
  else if (tab.offsetLeft + tab.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = tab.offsetLeft + tab.offsetWidth - box.clientWidth
}
watch(() => store.selectedId, async (id) => { await nextTick(); if (id) reveal(id); measure() })
/** A cell is still zero wide when it appears: scroll and measure again once it has finished growing or shrinking. */
function settled() { if (store.selectedId) reveal(store.selectedId); measure() }
let sizes: ResizeObserver | undefined
onMounted(() => { if (strip.value) { sizes = new ResizeObserver(measure); sizes.observe(strip.value) } measure() })
onBeforeUnmount(() => sizes?.disconnect())
// tabs opening, closing or a group folding change the width of the content, not of the strip
watch(() => [grouped.value.map((g) => `${g.group ?? ''}:${g.tabs.length}`).join('|'), Object.values(gs.hidden).join()], async () => { await nextTick(); measure() })
</script>

<template>
  <div class="tabbar" @wheel="onWheel">
    <div class="tab home-tab" :class="{ active: !store.selectedId }" role="tab" :aria-selected="!store.selectedId" title="Home" aria-label="Home" tabindex="0" @click="emit('select', null)" @keydown.enter="emit('select', null)">
      <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 7.75 8 3l5.5 4.75M4 6.75V13h8V6.75M6.75 13V9.75h2.5V13" /></svg>
    </div>
    <button v-if="more.left || more.right" class="tab-scroll left" title="Scroll the tabs left" aria-label="Scroll the tabs left" :disabled="!more.left" @click="page(-1)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg></button>
    <div ref="strip" class="tabs" role="tablist" aria-label="Open terminals" @scroll="measure">
    <TransitionGroup name="tabfx" @after-enter="settled" @after-leave="settled">
    <template v-for="{ key, g, s } in cells" :key="key">
    <div
      v-if="!s && g.group" class="tab-group" :style="{ '--g': colorCss(groupById(g.group).color) }"
      :class="{ collapsed: gs.hidden[g.group], needs: gs.hidden[g.group] && g.tabs.some((t) => ['answer', 'approve', 'error'].includes(flag(t)?.kind ?? '')) }"
      role="button" tabindex="0" :aria-expanded="!gs.hidden[g.group]" :title="gs.hidden[g.group] ? `Show ${g.tabs.length} terminals` : 'Click to hide this group · double-click to rename · right-click for options'"
      @click="gs.hidden[g.group!] = !gs.hidden[g.group!]" @dblclick.stop="startRename(g.group)" @keydown.enter="gs.hidden[g.group!] = !gs.hidden[g.group!]"
      @contextmenu.prevent.stop="openGroupMenu($event, g.group)" @dragover.prevent @drop="onDropOnGroup($event, g.group!)"
    >
      <input v-if="editing === g.group" v-model="editText" class="tab-group-input" aria-label="Group name" @click.stop @dblclick.stop @keydown.enter.stop="commitName" @keydown.esc.stop="editing = null" @blur="commitName" />
      <template v-else>{{ groupById(g.group).name }}</template>
    </div>
    <div
      v-else-if="s" class="tab" role="tab" :aria-selected="s.id === store.selectedId" :data-tab="s.id" :title="tip(s)" tabindex="0"
      :style="groupOfTab(s) ? { '--g': colorCss(groupById(groupOfTab(s)!).color) } : undefined"
      :class="[s.agentType, 'st-' + s.runtimeState.toLowerCase(), { grouped: !!groupOfTab(s) }, flag(s) ? 'flag-' + flag(s)!.kind : '', { active: s.id === store.selectedId, preview: !s.running, attention: s.needsAttention, dragging: dragId === s.id, 'drop-before': drop?.id === s.id && !drop.after, 'drop-after': drop?.id === s.id && drop.after }]"
      :draggable="isTab(s)" @dragstart="onDragStart($event, s)" @dragover="onDragOver($event, s)" @dragleave="drop = null" @drop="onDrop" @dragend="onDragEnd"
      @click="emit('select', s.id)" @contextmenu.prevent.stop="openTabMenu($event, s)" @auxclick.middle.prevent="close(s)" @keydown.enter="emit('select', s.id)"
    >
      <i class="tab-dot"></i>
      <AgentIcon :agent="s.agentType" />
      <span class="tab-title">{{ s.title }}</span>
      <span v-if="flag(s)" class="tab-flag" :class="flag(s)!.kind" :title="flag(s)!.kind === 'done' ? 'Finished' : flag(s)!.kind === 'error' ? 'Hit an error' : flag(s)!.kind === 'approve' ? 'Waiting for your approval' : 'Waiting for your answer'">{{ flag(s)!.text }}</span>
      <span v-if="s.speaking" class="speaking" title="Speaking"><span class="eq"><i></i><i></i><i></i></span></span>
      <button class="tab-close" :title="s.running ? 'Close terminal (stops the agent, keeps the conversation)' : 'Close'" :aria-label="`Close ${s.title}`" @click.stop="close(s)">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></svg>
      </button>
    </div>
    </template>
    </TransitionGroup>
    </div>
    <button v-if="more.left || more.right" class="tab-scroll right" title="Scroll the tabs right" aria-label="Scroll the tabs right" :disabled="!more.right" @click="page(1)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg></button>
    <button v-if="waiting.length" class="tab-alert" :title="`Jump to ${waiting[0]!.title}`" @click="emit('select', waiting[0]!.id)">
      <i></i>{{ waiting.length }} {{ waiting.length === 1 ? 'needs' : 'need' }} you
    </button>
    <button class="tab-new" title="New terminal (a plain shell, no agent) in this folder" aria-label="New terminal" @click="openTerminal">
      <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="m4.75 6.5 1.9 1.6-1.9 1.6M8.25 9.9h3" /></svg>
    </button>
    <Teleport to="body">
      <div v-if="tabMenu" class="menu" role="menu" :style="{ left: tabMenu.x + 'px', top: tabMenu.y + 'px' }" @click.stop @contextmenu.prevent>
        <button class="menu-item" role="menuitem" @click="act(() => newGroupWith(tabMenu!.s))">Add to new group</button>
        <template v-if="gs.groups.length">
          <div class="menu-label">Add to group</div>
          <button v-for="g in gs.groups" :key="g.id" class="menu-item" role="menuitem" @click="act(() => addTo(tabMenu!.s, g.id))"><i class="menu-dot" :style="{ background: colorCss(g.color) }"></i>{{ g.name }}<span v-if="gs.members[tabMenu.s.id] === g.id" class="menu-check">✓</span></button>
        </template>
        <button v-if="gs.members[tabMenu.s.id]" class="menu-item" role="menuitem" @click="act(() => removeFromGroup(tabMenu!.s))">Remove from group</button>
        <div class="menu-sep"></div>
        <button class="menu-item" role="menuitem" @click="act(() => close(tabMenu!.s))">Close tab</button>
      </div>
      <div v-if="groupMenu" class="menu" role="menu" :style="{ left: groupMenu.x + 'px', top: groupMenu.y + 'px' }" @click.stop @contextmenu.prevent>
        <button class="menu-item" role="menuitem" @click="act(() => startRename(groupMenu!.id))">Rename group</button>
        <div class="menu-label">Color</div>
        <div class="menu-swatches"><button v-for="c in COLORS" :key="c.id" class="swatch" :class="{ on: groupById(groupMenu.id).color === c.id }" :style="{ background: c.css }" :aria-label="c.id" @click="groupById(groupMenu!.id).color = c.id"></button></div>
        <div class="menu-sep"></div>
        <button class="menu-item" role="menuitem" @click="act(() => ungroup(groupMenu!.id))">Ungroup (keeps the terminals)</button>
      </div>
    </Teleport>
  </div>
</template>
