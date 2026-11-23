<script setup lang="ts">
import { ref } from 'vue'
import { notify, refreshStatus, store } from '../store'

/** Where an API key is typed. It goes straight to the app's encrypted key store; the page never gets it back (only "is there one"). */
const props = defineProps<{ provider: 'openai' | 'gemini'; hint?: string }>()
const draft = ref('')
const editing = ref(false)
const busy = ref(false)
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

async function save() {
  const key = draft.value.trim()
  if (!key) return
  busy.value = true
  try {
    await window.echo.secrets.set({ provider: props.provider, key })
    draft.value = ''; editing.value = false
    notify('info', 'API key saved.', 2500)
  } catch (e) { notify('error', clean(e)) } finally { busy.value = false; await refreshStatus() }
}
async function remove() {
  busy.value = true
  try { await window.echo.secrets.remove({ provider: props.provider }); notify('info', 'API key removed.', 2500) } catch (e) { notify('error', clean(e)) } finally { busy.value = false; await refreshStatus() }
}
</script>

<template>
  <div class="field wide">
    <div class="field-text"><strong>API key</strong><small>{{ hint ?? 'Stored encrypted on this computer. Never shown again and never given to the agents' }}</small></div>
    <div v-if="store.keys[provider] && !editing" class="row key-row">
      <span class="key-dots" aria-label="A key is saved">••••••••••••</span>
      <button class="btn small" :disabled="busy" @click="editing = true">Replace</button>
      <button class="btn small" :disabled="busy" @click="remove">Remove</button>
    </div>
    <div v-else class="row key-row">
      <input v-model="draft" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your key" aria-label="API key" @keydown.enter="save" />
      <button class="btn small primary" :disabled="busy || !draft.trim()" @click="save">Save</button>
      <button v-if="editing" class="btn small" @click="editing = false; draft = ''">Cancel</button>
    </div>
  </div>
  <p v-if="!store.keysPersist" class="hint">This computer has no secure key storage (keyring), so a key is kept only until you quit the app.</p>
</template>
