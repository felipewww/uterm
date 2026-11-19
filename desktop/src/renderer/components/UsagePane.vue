<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { UsageRow, UsageSummary } from '@shared/types'

const data = ref<UsageSummary | null>(null)
const error = ref('')
onMounted(async () => { try { data.value = await window.echo.usage.summary() as UsageSummary } catch (e) { error.value = (e as Error).message } })

const PROVIDER: Record<string, string> = { openai: 'OpenAI', gemini: 'Gemini' }
const KIND: Record<string, string> = { tts: 'Voice output', stt: 'Transcription', chat: 'English coach' }
const usd = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
const amount = (r: UsageRow) => (r.kind === 'chat' ? 'text' : r.kind === 'tts' ? `${Math.round(r.chars).toLocaleString()} chars · ${(r.audioSeconds / 60).toFixed(1)} min` : `${(r.audioSeconds / 60).toFixed(1)} min`)
const total = (rows: UsageRow[]) => rows.reduce((n, r) => n + r.costUsd, 0)
const periods = [{ key: 'today', label: 'Today' }, { key: 'month', label: 'This month' }, { key: 'all', label: 'All time' }] as const
</script>

<template>
  <h3 class="pane-title">Cloud spend (estimated)</h3>
  <p class="hint">Every cloud voice or transcription call is recorded with the usage the provider reported (or the audio length we measured) and priced at the public list price. These are estimates for keeping track: the provider dashboards hold the real bill. Local voice is free and not listed.</p>
  <p v-if="error" class="error-text">{{ error }}</p>
  <template v-if="data">
    <div v-for="p in periods" :key="p.key" class="usage-block">
      <div class="usage-head"><strong>{{ p.label }}</strong><span class="usage-total">{{ usd(total(data[p.key])) }}</span></div>
      <p v-if="!data[p.key].length" class="hint">No cloud calls yet.</p>
      <div v-for="r in data[p.key]" :key="r.provider + r.kind" class="usage-row">
        <span>{{ PROVIDER[r.provider] ?? r.provider }} · {{ KIND[r.kind] ?? r.kind }}</span>
        <span class="muted">{{ r.calls }} call{{ r.calls === 1 ? '' : 's' }} · {{ amount(r) }}</span>
        <span class="usage-cost">{{ usd(r.costUsd) }}<small v-if="r.unpriced" title="Some calls use a model we have no price for"> +{{ r.unpriced }} unpriced</small></span>
      </div>
    </div>
  </template>
</template>
