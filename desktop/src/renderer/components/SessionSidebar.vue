<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { SessionView } from '@shared/types'
import { store } from '../store'

const emit = defineEmits<{ select: [id: string]; create: []; settings: [] }>()
const query = ref('')
const showArchived = ref(false)
const editingId = ref<string | null>(null)
const editText = ref('')
const editInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return store.sessions
    .filter((s) => (showArchived.value ? true : !s.archivedAt))
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.workingDirectory.toLowerCase().includes(q) || s.agentType.includes(q))
})
const active = computed(() => filtered.value.filter((s) => s.running))
const closed = computed(() => filtered.value.filter((s) => !s.running))

const stateLabel: Record<string, string> = {
  STARTING: 'Starting', IDLE: 'Idle', WORKING: 'Working', WAITING_FOR_INPUT: 'Needs your input',
  WAITING_FOR_PERMISSION: 'Needs permission', ERROR: 'Error', CLOSED: 'Closed'
}
const voiceLabel = (s: SessionView) => (s.muted ? 'muted' : s.speaking ? 'speaking' : 'voice on')
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
const shortDir = (p: string) => p.replace(/^\/home\/[^/]+/, '~')

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
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="brand">Sessions</span>
      <button class="icon-btn" title="New session" @click="emit('create')">＋</button>
    </div>
    <input v-model="query" class="search" placeholder="Search sessions…" />
    <div class="session-groups">
      <template v-for="group in [{ name: 'Active', list: active }, { name: 'Closed', list: closed }]" :key="group.name">
        <div v-if="group.list.length" class="group-title">{{ group.name }} · {{ group.list.length }}</div>
        <div
          v-for="s in group.list" :key="s.id" class="session"
          :class="{ selected: s.id === store.selectedId, attention: s.needsAttention, archived: !!s.archivedAt }"
          @click="emit('select', s.id)" @dblclick.stop="startEdit(s)"
        >
          <span class="dot" :class="s.runtimeState.toLowerCase()" :title="stateLabel[s.runtimeState]"></span>
          <div class="session-body">
            <input v-if="editingId === s.id" ref="editInput" v-model="editText" class="rename" @click.stop @keydown.enter="commitEdit" @keydown.esc="editingId = null" @blur="commitEdit" />
            <div v-else class="session-title">{{ s.title }}<span v-if="s.needsAttention" class="badge">!</span></div>
            <div class="session-meta">{{ s.agentType === 'claude' ? 'Claude' : 'Codex' }} · {{ shortDir(s.workingDirectory) }}</div>
            <div class="session-meta">
              <span>{{ stateLabel[s.runtimeState] }}</span> · <span :class="{ speaking: s.speaking }">{{ voiceLabel(s) }}</span> · {{ ago(s.lastActivityAt) }}
            </div>
          </div>
          <div class="session-actions" @click.stop>
            <button v-if="s.running" class="icon-btn small" title="Close session (keeps history)" @click="close(s)">■</button>
            <button class="icon-btn small" :title="s.archivedAt ? 'Unarchive' : 'Archive'" @click="archive(s)">{{ s.archivedAt ? '↺' : '🗄' }}</button>
          </div>
        </div>
      </template>
      <div v-if="!filtered.length" class="empty">No sessions yet. Press ＋ to start one.</div>
    </div>
    <div class="sidebar-foot">
      <label class="check"><input v-model="showArchived" type="checkbox" /> Show archived</label>
      <button class="link-btn" @click="emit('settings')">⚙ Settings</button>
    </div>
  </aside>
</template>
