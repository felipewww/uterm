<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AGENT_LABELS, ON_MAC } from '@shared/types'
import { ingestHistory, selected, store } from '../store'
import { copySelection, focusTerminal, hasSelection, pasteInto, selectAllIn, showTerminal, terminalSize } from '../terminals'

const container = ref<HTMLElement | null>(null)
const starting = ref(false)
const startError = ref('')
const resumeBtn = ref<HTMLButtonElement | null>(null)

// right click on the terminal: copy what is selected, paste, select all
const menu = ref<{ x: number; y: number; id: string; copy: boolean } | null>(null)
const closeMenu = () => { menu.value = null }
function openMenu(e: MouseEvent) {
  const s = selected()
  if (!s || !s.running) return
  menu.value = { x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 140), id: s.id, copy: hasSelection(s.id) }
}
function act(fn: (id: string) => void) { const id = menu.value?.id; closeMenu(); if (id) { fn(id); focusTerminal(id) } }
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
onMounted(() => { window.addEventListener('click', closeMenu); window.addEventListener('blur', closeMenu); window.addEventListener('keydown', onKey, true) })
onBeforeUnmount(() => { window.removeEventListener('click', closeMenu); window.removeEventListener('blur', closeMenu); window.removeEventListener('keydown', onKey, true) })

function show() {
  if (!container.value) return
  const s = selected()
  showTerminal(container.value, s && s.running ? s.id : null)
}

const closed = computed(() => { const s = selected(); return !!s && !s.running })
const resumable = computed(() => !!selected()?.nativeSessionId)
const isShell = computed(() => selected()?.agentType === 'shell')
const agent = computed(() => (selected() ? AGENT_LABELS[selected()!.agentType] : null))
const missing = computed(() => { const a = selected() ? store.agents[selected()!.agentType] : undefined; return !!a && !a.installed })
const lastMessage = computed(() => {
  const list = store.selectedId ? store.activity[store.selectedId] ?? [] : []
  return [...list].reverse().find((i) => i.kind === 'final' || i.kind === 'progress')
})
const shortDir = (p: string) => p.replace(/^\/home\/[^/]+/, '~')
const when = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

watch(() => [store.selectedId, selected()?.running], async () => { await Promise.resolve(); show() }, { flush: 'post' })
// Closed session: load its history for the preview and put the focus on the primary button (Enter resumes).
watch(() => [store.selectedId, closed.value], async ([id, c]) => {
  startError.value = ''
  if (!id || !c) return
  if (!store.activity[id as string]?.length) {
    try { ingestHistory(id as string, await window.echo.sessions.activity({ id })) } catch { /* preview is optional */ }
  }
  await Promise.resolve()
  resumeBtn.value?.focus()
}, { immediate: true, flush: 'post' })
// A plain terminal never waits for a resume: choosing a closed one just opens a new shell (in the folder it was in).
watch(() => store.selectedId, async (id) => {
  const s = selected()
  if (id && s && s.agentType === 'shell' && !s.running) { await Promise.resolve(); await resume() }
}, { immediate: true })
onMounted(show)

async function openVscode() { if (selected()) await window.echo.sessions.openInVscode({ id: selected()!.id }) }
async function resume() {
  const s = selected()
  if (!s) return
  starting.value = true; startError.value = ''
  try {
    const { cols, rows } = terminalSize(s.id)
    await window.echo.sessions.start({ id: s.id, cols, rows })
  } catch (err) {
    startError.value = (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  } finally { starting.value = false }
}
</script>

<template>
  <div class="terminal-wrap">
    <div ref="container" class="terminal-container" @contextmenu.prevent="openMenu"></div>
    <Teleport to="body">
      <div v-if="menu" class="menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop @contextmenu.prevent>
        <button class="menu-item" role="menuitem" :disabled="!menu.copy" @click="act(copySelection)">Copy<kbd class="kbd">{{ ON_MAC ? '⌘C' : 'Ctrl+Shift+C' }}</kbd></button>
        <button class="menu-item" role="menuitem" @click="act(pasteInto)">Paste<kbd class="kbd">{{ ON_MAC ? '⌘V' : 'Ctrl+Shift+V' }}</kbd></button>
        <button class="menu-item" role="menuitem" @click="act(selectAllIn)">Select all</button>
      </div>
    </Teleport>
    <div v-if="closed" class="terminal-overlay">
      <div class="resume-card" role="dialog" aria-label="Closed session">
        <div class="resume-top">
          <span class="agent-tag" :class="selected()!.agentType">{{ agent!.short }}</span>
          <span class="resume-status"><i class="dot closed"></i>Closed</span>
        </div>
        <h3 class="resume-title">{{ selected()!.title }}</h3>
        <dl class="resume-meta">
          <dt>Folder</dt><dd :title="selected()!.workingDirectory">{{ shortDir(selected()!.workingDirectory) }}</dd>
          <dt>Last activity</dt><dd>{{ when(selected()!.lastActivityAt) }}</dd>
          <dt>Agent</dt><dd>{{ agent!.label }}</dd>
          <template v-if="selected()!.configDir"><dt>Account</dt><dd :title="selected()!.configDir!">{{ shortDir(selected()!.configDir!) }}</dd></template>
        </dl>
        <figure v-if="lastMessage" class="resume-last">
          <figcaption>{{ lastMessage.kind === 'final' ? 'Last result' : 'Last update' }}</figcaption>
          <blockquote>{{ lastMessage.text }}</blockquote>
        </figure>
        <p class="resume-note">{{ isShell ? 'This terminal is closed. Opening it starts a new shell in the same folder.' : resumable ? 'Resume reopens the agent and continues this same conversation.' : 'No conversation was recorded for this session, so this starts a new one in the same folder.' }}</p>
        <div v-if="missing" class="banner warn">{{ agent!.label }} is not installed on this machine, so this session cannot be started.</div>
        <div v-if="startError" class="banner danger" role="alert">{{ startError }}</div>
        <div class="resume-actions">
          <button ref="resumeBtn" class="btn primary resume-go" :disabled="starting || missing" @click="resume">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5 3.25v9.5L12.5 8z" /></svg>
            {{ starting ? 'Starting…' : startError ? 'Try again' : isShell ? 'Open terminal' : resumable ? 'Resume conversation' : 'Start session' }}
            <kbd v-if="!starting" class="kbd on-accent">↵</kbd>
          </button>
          <button class="btn ghost" title="Open the folder in VS Code" @click="openVscode">Open in VS Code</button>
          <button class="btn ghost danger-text" title="Delete this session" @click="store.confirmDelete = selected()!">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>
