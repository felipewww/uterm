<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { AppSettings } from '@shared/types'
import { parseVoiceId } from '@shared/voices'
import { store } from '../store'
import ApiKeyField from './ApiKeyField.vue'

/** Everything one cloud engine needs, for one direction: its key and the model to use (plus the style, for voices). */
const props = defineProps<{ g: AppSettings; provider: 'openai' | 'gemini'; kind: 'tts' | 'stt' }>()
const s = props.g // the parent's reactive settings draft: saved with its Save button
const p = props.provider
const modelField = (p === 'openai' ? (props.kind === 'tts' ? 'openaiTtsModel' : 'openaiSttModel') : (props.kind === 'tts' ? 'geminiTtsModel' : 'geminiSttModel')) as keyof AppSettings
const styleField = (p === 'openai' ? 'openaiVoiceStyle' : 'geminiVoiceStyle') as 'openaiVoiceStyle' | 'geminiVoiceStyle'
const models = ref<string[]>([])
const busy = ref<'' | 'models' | 'test'>('')
const note = ref('')
interface Step { name: string; ok: boolean; ms: number; detail: string }
const report = ref<{ steps: Step[]; costUsd: number } | null>(null)
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
// The sentence the Test speaks. Tags such as [happy] or [whispering] are sent as they are: both providers act on them.
const phrase = ref("[happy] Great news, the build passed! [chuckle] I did not expect that on the first try. [whispering] Let's keep this between us.")
const state = reactive({ listId: `${p}-${props.kind}-models` })

async function refresh() {
  busy.value = 'models'; note.value = ''
  try {
    const m = await window.echo.cloud.models({ provider: p })
    models.value = props.kind === 'tts' ? m.tts : m.stt
    note.value = `${models.value.length} models found. Pick from the list.`
  } catch (e) { note.value = clean(e) } finally { busy.value = '' }
}
const testVoice = () => { const v = parseVoiceId(s.defaultVoiceId); return v.provider === p ? v.voice : p === 'openai' ? 'coral' : 'Kore' }
async function test() {
  busy.value = 'test'; report.value = null; note.value = ''
  try {
    report.value = await window.echo.cloud.test({ provider: p, ttsModel: String(s[p === 'openai' ? 'openaiTtsModel' : 'geminiTtsModel']), voice: testVoice(), sttModel: String(s[p === 'openai' ? 'openaiSttModel' : 'geminiSttModel']), style: s[styleField], ...(props.kind === 'tts' ? { text: phrase.value } : {}) }) as { steps: Step[]; costUsd: number }
  } catch (e) { note.value = clean(e) } finally { busy.value = '' }
}
</script>

<template>
  <ApiKeyField :provider="provider" />
  <div class="field wide">
    <div class="field-text"><strong>{{ kind === 'tts' ? 'Voice model' : 'Transcription model' }}</strong><small>Model names change over time, so this is editable</small></div>
    <input v-model="(s as any)[modelField]" :list="state.listId" spellcheck="false" />
    <datalist :id="state.listId"><option v-for="m in models" :key="m" :value="m" /></datalist>
  </div>
  <div v-if="kind === 'tts'" class="field wide">
    <div class="field-text"><strong>Voice style</strong><small>{{ provider === 'openai' ? 'How the voice is asked to sound. Used only by OpenAI voices' : 'How the voice is asked to sound. Used only by Gemini voices' }}</small></div>
    <input v-model="s[styleField]" maxlength="200" />
  </div>
  <div v-if="kind === 'tts'" class="field wide">
    <div class="field-text"><strong>Test phrase</strong><small>The voice acts on [tags] like [happy] or [whispering]. Edit the text to try your own</small></div>
    <textarea v-model="phrase" rows="3" maxlength="600" spellcheck="false" aria-label="Test phrase"></textarea>
  </div>
  <div class="cloud-actions">
    <button class="btn" :disabled="!store.keys[provider] || !!busy" @click="refresh">{{ busy === 'models' ? 'Checking…' : 'Refresh model list' }}</button>
    <button class="btn primary" :disabled="!store.keys[provider] || !!busy" title="Checks the key, speaks the test phrase and transcribes it back. Costs a fraction of a cent." @click="test">{{ busy === 'test' ? 'Testing…' : 'Test' }}</button>
  </div>
  <p v-if="note" class="hint">{{ note }}</p>
  <ul v-if="report" class="test-steps">
    <li v-for="st in report.steps" :key="st.name" :class="st.ok ? 'ok' : 'bad'"><i></i><div><strong>{{ st.name }}</strong><span v-if="st.ms" class="ms">{{ (st.ms / 1000).toFixed(1) }}s</span><small>{{ st.detail }}</small></div></li>
    <li class="total"><div><small>Estimated cost of this test: ${{ report.costUsd.toFixed(4) }}</small></div></li>
  </ul>
</template>
