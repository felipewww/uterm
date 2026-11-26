<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { notify, selected } from '../store'

/** Commands the user chose to keep for a plain terminal (only the commands, never the output). Nothing runs unless clicked. */
interface Cmd { id: string; label: string | null; command: string }
const list = ref<Cmd[]>([])
const text = ref('')
const label = ref('')
const s = computed(() => selected())
const isShell = computed(() => s.value?.agentType === 'shell')
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

async function load() { list.value = isShell.value && s.value ? await window.echo.commands.list({ sessionId: s.value.id }) : [] }
watch(() => [s.value?.id, isShell.value], load, { immediate: true })

async function add() {
  if (!s.value || !text.value.trim()) return
  try { await window.echo.commands.add({ sessionId: s.value.id, command: text.value, label: label.value || null }); text.value = ''; label.value = ''; await load() } catch (e) { notify('error', clean(e), 5000) }
}
async function remove(c: Cmd) { await window.echo.commands.remove({ id: c.id }); await load() }
async function run(c: Cmd, go: boolean) {
  const ok = await window.echo.commands.run({ id: c.id, run: go })
  if (!ok) notify('info', 'Open the terminal first: commands are only sent to a running plain terminal.', 4000)
}
</script>

<template>
  <div class="cmds">
    <div v-if="!isShell" class="cmds-empty">Saved commands belong to plain terminals.<small>Open one with New session → New terminal.</small></div>
    <template v-else>
      <header class="cmds-head">
        <h3>Saved commands</h3>
        <small>For this terminal only. Output is never saved.</small>
      </header>

      <form class="cmd-form" @submit.prevent="add">
        <input v-model="label" class="cmd-input" placeholder="Title (optional)" aria-label="Title" />
        <div class="cmd-form-row">
          <input v-model="text" class="cmd-input mono" placeholder="Command, e.g. docker compose up mysql" aria-label="Command" />
          <button class="btn primary" type="submit" :disabled="!text.trim()">Save</button>
        </div>
      </form>

      <ul v-if="list.length" class="cmds-list">
        <li v-for="c in list" :key="c.id" class="cmd">
          <div class="cmd-body">
            <span v-if="c.label" class="cmd-label">{{ c.label }}</span>
            <code class="cmd-code">{{ c.command }}</code>
          </div>
          <div class="cmd-actions">
            <button class="cmd-act paste" title="Paste into the terminal (you press Enter)" aria-label="Paste into the terminal" @click="run(c, false)">
              <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="m4.75 6.5 1.9 1.6-1.9 1.6M8.25 9.9h3" /></svg>
            </button>
            <button class="cmd-act run" title="Run it now" aria-label="Run it now" @click="run(c, true)">
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M5.5 3.5v9l7-4.5z" /></svg>
            </button>
            <button class="cmd-act danger" title="Remove" aria-label="Remove command" @click="remove(c)">
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 5h9M6.5 5V3.5h3V5M5 5l.5 7.5h5L11 5" /></svg>
            </button>
          </div>
        </li>
      </ul>
      <div v-else class="cmds-empty">Nothing saved yet.<small>Add the commands you run often, like <code>npm run start:dev</code>.</small></div>
</template>
  </div>
</template>
