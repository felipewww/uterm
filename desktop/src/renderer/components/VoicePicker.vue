<script setup lang="ts">
import { computed } from 'vue'
import { GEMINI_VOICES, OPENAI_VOICES, parseVoiceId } from '@shared/voices'
import { store } from '../store'

/**
 * One list of every voice: local ones (the built-in voice and clones) and the cloud ones. The provider is part of the voice,
 * so this is how a chat chooses where it is spoken. `inherit` adds a first option (empty value) for "use the default".
 */
const props = defineProps<{ modelValue: string; inherit?: string; previewButton?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [id: string] }>()

const groups = computed(() => [
  { label: 'On this machine', provider: 'local' as const, voices: store.voices.map((v) => ({ id: v.id, label: v.name })) },
  { label: 'Google Gemini (cloud)', provider: 'gemini' as const, voices: GEMINI_VOICES.map((v) => ({ id: v.id, label: `${v.name} · ${v.trait}` })) },
  { label: 'OpenAI (cloud)', provider: 'openai' as const, voices: OPENAI_VOICES.map((v) => ({ id: v.id, label: v.name })) }
])
const usable = (p: 'local' | 'gemini' | 'openai') => p === 'local' || store.keys[p]
const id = computed(() => props.modelValue)
const canPreview = computed(() => !!props.modelValue)
async function preview() { if (props.modelValue) await window.echo.voice.preview({ voiceId: props.modelValue }) }
const cloud = computed(() => parseVoiceId(props.modelValue).provider !== 'local')
</script>

<template>
  <div class="voice-picker">
    <select :value="id" aria-label="Voice" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option v-if="inherit !== undefined" value="">{{ inherit }}</option>
      <optgroup v-for="g in groups" :key="g.provider" :label="usable(g.provider) ? g.label : `${g.label}: no API key`">
        <option v-for="v in g.voices" :key="v.id" :value="v.id" :disabled="!usable(g.provider)">{{ v.label }}</option>
      </optgroup>
    </select>
    <button v-if="previewButton" class="btn" :disabled="!canPreview" :title="cloud ? 'Plays a sample (cloud voices cost a fraction of a cent)' : 'Plays a sample'" @click="preview">Preview</button>
  </div>
</template>
