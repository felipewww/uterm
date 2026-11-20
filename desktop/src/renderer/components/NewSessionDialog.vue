<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AGENT_LABELS, CODING_AGENTS, type AgentType } from '@shared/types'
import { selected, store, upsertSession } from '../store'
import AgentIcon from './AgentIcon.vue'

const emit = defineEmits<{ close: []; created: [id: string] }>()

/** What to start: an agent session (Claude Code, Codex or Kiro) or a fresh plain terminal. */
const mode = ref<'agent' | 'terminal'>('agent')

// An agent is usable unless detection has run and did not find it (unknown yet = assume usable).
const usable = (t: AgentType) => !store.agents[t] || store.agents[t]!.installed
const options = computed(() => CODING_AGENTS.map((t) => {
  const a = store.agents[t]
  return { type: t, label: AGENT_LABELS[t].label, version: a?.version, usable: usable(t), path: a?.path }
}))
const noneInstalled = computed(() => Object.keys(store.agents).length > 0 && options.value.every((o) => !o.usable))
const agent = ref<AgentType>(store.settings.defaultAgent)
// Never preselect a CLI that is not installed (e.g. only Kiro on this machine): fall back to the first one that is.
const pickUsable = () => { if (!usable(agent.value)) agent.value = options.value.find((o) => o.usable)?.type ?? agent.value }
pickUsable()
watch(() => store.agents, pickUsable, { deep: true })

const title = ref('')
const dir = ref('')
const termDir = ref(selected()?.workingDirectory ?? '') // empty = the home folder
const termTitle = ref('')
const error = ref('')
const busy = ref(false)
const imports = ref<Array<{ agent: AgentType; nativeId: string; cwd: string; title: string; mtime: number; configDir?: string | null }>>([])
// Claude can run with several config folders (accounts), e.g. a second one behind a `claudeme` alias.
const profiles = ref<Array<{ dir: string | null; label: string }>>([])
const profile = ref<string | null>(null)

onMounted(async () => {
  imports.value = await window.echo.sessions.listImportable()
  profiles.value = await window.echo.sessions.claudeProfiles()
})

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, '~')
async function pick() { const d = await window.echo.sessions.pickDirectory(); if (d) { dir.value = d; if (!title.value) title.value = d.split('/').filter(Boolean).pop() ?? '' } }
async function pickTerminalDir() { const d = await window.echo.sessions.pickDirectory(); if (d) termDir.value = d }

async function create() {
  error.value = ''
  if (mode.value === 'agent' && !dir.value) { error.value = 'Choose a working directory first.'; return }
  busy.value = true
  try {
    const v = mode.value === 'terminal'
      ? await window.echo.sessions.create({ agentType: 'shell', title: termTitle.value, workingDirectory: termDir.value || '~' })
      : await window.echo.sessions.create({ agentType: agent.value, title: title.value, workingDirectory: dir.value, configDir: agent.value === 'claude' ? profile.value : null })
    upsertSession(v); emit('created', v.id)
  } catch (e) { error.value = clean(e) } finally { busy.value = false }
}
async function importOne(i: (typeof imports.value)[number]) {
  busy.value = true; error.value = ''
  try {
    const v = await window.echo.sessions.importSession({ agentType: i.agent, nativeSessionId: i.nativeId, workingDirectory: i.cwd, title: i.title, configDir: i.configDir ?? null })
    upsertSession(v); emit('created', v.id)
  } catch (e) { error.value = clean(e) } finally { busy.value = false }
}
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const profileLabel = (d: string | null | undefined) => (d ? profiles.value.find((p) => p.dir === d)?.label ?? tilde(d) : '')
const ago = (t: number) => { const d = Math.round((Date.now() - t) / 86400000); return d < 1 ? 'today' : `${d}d ago` }
const canCreate = computed(() => !busy.value && (mode.value === 'terminal' || usable(agent.value)))
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="modal new-modal" role="dialog" aria-label="New">
      <header class="nm-head">
        <h2>Start something new</h2>
        <button class="icon-btn" aria-label="Close" @click="emit('close')"><svg class="x" viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
      </header>

      <!-- what to start -->
      <div class="nm-mode" role="tablist" aria-label="What to start">
        <button class="nm-mode-btn" role="tab" :aria-selected="mode === 'agent'" :class="{ active: mode === 'agent' }" @click="mode = 'agent'">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 2.25v3.5M8 10.25v3.5M2.25 8h3.5M10.25 8h3.5M4 4l2.5 2.5M9.5 9.5 12 12M12 4 9.5 6.5M6.5 9.5 4 12" /></svg>
          <span><strong>New session</strong><small>Claude Code, Codex or Kiro</small></span>
        </button>
        <button class="nm-mode-btn" role="tab" :aria-selected="mode === 'terminal'" :class="{ active: mode === 'terminal' }" @click="mode = 'terminal'">
          <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="m4.75 6.5 1.9 1.6-1.9 1.6M8.25 9.9h3" /></svg>
          <span><strong>New terminal</strong><small>A fresh shell, no agent</small></span>
        </button>
      </div>

      <!-- agent session -->
      <template v-if="mode === 'agent'">
        <div class="nm-label">Agent</div>
        <div class="nm-agents" role="radiogroup" aria-label="Coding agent">
          <button
            v-for="o in options" :key="o.type" class="nm-agent" role="radio" :aria-checked="agent === o.type" :class="[o.type, { active: agent === o.type }]"
            :disabled="!o.usable" :title="o.usable ? o.path : 'Not installed on this machine'" @click="agent = o.type"
          >
            <AgentIcon :agent="o.type" />
            <strong>{{ AGENT_LABELS[o.type].short }}</strong>
            <small>{{ o.usable ? (o.version ?? 'installed') : 'not installed' }}</small>
          </button>
        </div>
        <p v-if="noneInstalled" class="warn-text">
          No supported CLI was found (Claude Code, Codex CLI or Kiro CLI). Install one and make sure it runs from a terminal; the app also looks in ~/.local/bin, /usr/local/bin and Homebrew.
        </p>
        <label v-if="agent === 'claude' && profiles.length > 1" class="nm-field"><span class="nm-label">Claude account</span>
          <select v-model="profile"><option v-for="p in profiles" :key="p.dir ?? 'default'" :value="p.dir">{{ p.label }}</option></select>
        </label>
        <label class="nm-field"><span class="nm-label">Title</span><input v-model="title" placeholder="e.g. Auth refactor" @keydown.enter="create" /></label>
        <div class="nm-field">
<span class="nm-label">Working directory</span>
          <div class="row"><input v-model="dir" readonly placeholder="Choose a folder…" @click="pick" /><button class="btn" @click="pick">Browse…</button></div>
        </div>
      </template>

      <!-- plain terminal -->
      <template v-else>
        <p class="nm-note">A plain shell, with your own aliases and PATH. No agent, no activity feed, nothing is spoken, and voice input is never typed into it.</p>
        <div class="nm-field">
<span class="nm-label">Start in</span>
          <div class="row"><input :value="termDir ? tilde(termDir) : 'Home folder (~)'" readonly @click="pickTerminalDir" /><button class="btn" @click="pickTerminalDir">Browse…</button><button v-if="termDir" class="btn ghost" title="Use the home folder" @click="termDir = ''">Home</button></div>
        </div>
        <label class="nm-field"><span class="nm-label">Name <small>(optional)</small></span><input v-model="termTitle" placeholder="Terminal" @keydown.enter="create" /></label>
      </template>

      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="modal-actions">
        <button class="btn" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="!canCreate" @click="create">{{ mode === 'terminal' ? 'Open terminal' : 'Start session' }}</button>
      </div>

      <details v-if="mode === 'agent' && imports.length" class="import">
        <summary>Import an existing conversation ({{ imports.length }})</summary>
        <div v-for="i in imports" :key="i.agent + i.nativeId" class="import-row" @click="importOne(i)">
          <strong>{{ i.title }}</strong>
          <span class="muted">{{ AGENT_LABELS[i.agent].short }}{{ i.configDir ? ` (${profileLabel(i.configDir)})` : '' }} · {{ tilde(i.cwd) }} · {{ ago(i.mtime) }}</span>
        </div>
      </details>
    </div>
  </div>
</template>
