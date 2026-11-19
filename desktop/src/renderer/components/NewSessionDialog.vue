<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AgentType } from '@shared/types'
import { store, upsertSession } from '../store'

const emit = defineEmits<{ close: []; created: [id: string] }>()
const agent = ref<AgentType>(store.settings.defaultAgent)
const title = ref('')
const dir = ref('')
const error = ref('')
const busy = ref(false)
const imports = ref<Array<{ agent: AgentType; nativeId: string; cwd: string; title: string; mtime: number }>>([])

onMounted(async () => { imports.value = await window.echo.sessions.listImportable() })

async function pick() { const d = await window.echo.sessions.pickDirectory(); if (d) { dir.value = d; if (!title.value) title.value = d.split('/').filter(Boolean).pop() ?? '' } }
async function create() {
  if (!dir.value) { error.value = 'Choose a working directory first.'; return }
  busy.value = true; error.value = ''
  try {
    const v = await window.echo.sessions.create({ agentType: agent.value, title: title.value, workingDirectory: dir.value })
    upsertSession(v); emit('created', v.id)
  } catch (e) { error.value = clean(e) } finally { busy.value = false }
}
async function importOne(i: (typeof imports.value)[number]) {
  busy.value = true; error.value = ''
  try {
    const v = await window.echo.sessions.importSession({ agentType: i.agent, nativeSessionId: i.nativeId, workingDirectory: i.cwd, title: i.title })
    upsertSession(v); emit('created', v.id)
  } catch (e) { error.value = clean(e) } finally { busy.value = false }
}
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const ago = (t: number) => { const d = Math.round((Date.now() - t) / 86400000); return d < 1 ? 'today' : `${d}d ago` }
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal">
      <h2>New session</h2>
      <label>Coding agent
        <select v-model="agent">
          <option value="claude" :disabled="store.agents.claude && !store.agents.claude.installed">Claude Code {{ store.agents.claude?.version ? `(${store.agents.claude.version})` : '' }}</option>
          <option value="codex" :disabled="store.agents.codex && !store.agents.codex.installed">Codex CLI {{ store.agents.codex?.version ? `(${store.agents.codex.version})` : '' }}</option>
        </select>
      </label>
      <label>Title <input v-model="title" placeholder="e.g. Auth refactor" @keydown.enter="create" /></label>
      <label>Working directory
        <div class="row"><input v-model="dir" readonly placeholder="Choose a folder…" /><button class="btn" @click="pick">Browse…</button></div>
      </label>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="modal-actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy" @click="create">Create</button>
      </div>
      <details v-if="imports.length" class="import">
        <summary>Import an existing conversation ({{ imports.length }})</summary>
        <div v-for="i in imports" :key="i.agent + i.nativeId" class="import-row" @click="importOne(i)">
          <strong>{{ i.title }}</strong>
          <span class="muted">{{ i.agent === 'claude' ? 'Claude' : 'Codex' }} · {{ i.cwd.replace(/^\/home\/[^/]+/, '~') }} · {{ ago(i.mtime) }}</span>
        </div>
      </details>
    </div>
  </div>
</template>
