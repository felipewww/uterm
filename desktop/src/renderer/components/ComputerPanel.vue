<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { AGENT_LABELS } from '@shared/types'
import { selected } from '../store'
import AgentIcon from './AgentIcon.vue'

interface Sample {
  cpu: { threads: number[]; total: number; model: string; load: [number, number, number] }
  memory: { totalKb: number; usedKb: number; availableKb: number; swapTotalKb: number; swapUsedKb: number }
  uptimeSec: number
  terminal?: { pid: number; uptimeSec: number; processes: number; cpu: number; rssKb: number; top: Array<{ pid: number; name: string; cpu: number; rssKb: number }> } | null
}

const sample = ref<Sample | null>(null)
const error = ref('')
let timer: number | undefined
let busy = false

async function poll() {
  if (busy || document.visibilityState === 'hidden') return
  busy = true
  try {
    const s = selected()
    sample.value = await window.echo.system.sample({ sessionId: s?.running ? s.id : null }) as Sample
    error.value = ''
  } catch (e) { error.value = (e as Error).message } finally { busy = false }
}
onMounted(() => { void poll(); timer = window.setInterval(poll, 1500) })
onBeforeUnmount(() => clearInterval(timer))

const sel = computed(() => selected())
const gib = (kb: number) => (kb / 1048576).toFixed(kb >= 10 * 1048576 ? 0 : 1)
const size = (kb: number) => (kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} GiB` : `${Math.round(kb / 1024)} MiB`)
const pct = (n: number) => `${Math.round(n)}%`
const level = (n: number) => (n >= 85 ? 'hot' : n >= 60 ? 'warm' : 'ok')
const span = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s` }
const memPct = computed(() => (sample.value ? (sample.value.memory.usedKb / Math.max(1, sample.value.memory.totalKb)) * 100 : 0))
const swapPct = computed(() => (sample.value && sample.value.memory.swapTotalKb ? (sample.value.memory.swapUsedKb / sample.value.memory.swapTotalKb) * 100 : 0))
</script>

<template>
  <div class="computer">
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-else-if="!sample" class="muted">Reading the machine…</p>
    <template v-else>
      <section>
        <div class="cp-head"><strong>CPU</strong><span class="cp-val">{{ pct(sample.cpu.total) }}</span><small>load {{ sample.cpu.load.map((l) => l.toFixed(2)).join(' · ') }}</small></div>
        <div class="threads">
          <div v-for="(t, i) in sample.cpu.threads" :key="i" class="thread" :title="`Thread ${i}: ${pct(t)}`">
            <span class="thread-n">{{ i }}</span>
            <span class="meter small" :class="level(t)"><i :style="{ width: Math.min(100, t) + '%' }"></i></span>
            <span class="thread-v">{{ pct(t) }}</span>
          </div>
        </div>
        <small class="cp-model" :title="sample.cpu.model">{{ sample.cpu.model }} · {{ sample.cpu.threads.length }} threads</small>
      </section>

      <section>
        <div class="cp-head"><strong>Memory</strong><span class="cp-val">{{ gib(sample.memory.usedKb) }} / {{ gib(sample.memory.totalKb) }} GiB</span></div>
        <span class="meter" :class="level(memPct)"><i :style="{ width: Math.min(100, memPct) + '%' }"></i></span>
        <div class="cp-head sub"><strong>Swap</strong><span class="cp-val">{{ sample.memory.swapTotalKb ? `${gib(sample.memory.swapUsedKb)} / ${gib(sample.memory.swapTotalKb)} GiB` : 'none' }}</span></div>
        <span class="meter" :class="level(swapPct)"><i :style="{ width: Math.min(100, swapPct) + '%' }"></i></span>
        <small class="cp-model">Up {{ span(sample.uptimeSec) }}</small>
      </section>

      <section v-if="sel" class="cp-terminal">
        <div class="cp-head">
          <AgentIcon :agent="sel.agentType" class="cp-icon" :class="sel.agentType" />
          <strong class="cp-title" :title="sel.title">{{ sel.title }}</strong><small>{{ AGENT_LABELS[sel.agentType].label }}</small>
        </div>
        <p v-if="!sample.terminal" class="muted">{{ sel.running ? 'No process information for this terminal.' : 'This terminal is closed.' }}</p>
        <template v-else>
          <dl class="cp-facts">
            <dt>PID</dt><dd>{{ sample.terminal.pid }}</dd>
            <dt>Open for</dt><dd>{{ span(sample.terminal.uptimeSec) }}</dd>
            <dt>Processes</dt><dd>{{ sample.terminal.processes }}</dd>
            <dt>CPU</dt><dd>{{ pct(sample.terminal.cpu) }} <small>(100% = one thread)</small></dd>
            <dt>Memory</dt><dd>{{ size(sample.terminal.rssKb) }}</dd>
          </dl>
          <div class="cp-top">
            <div class="cp-top-head"><span>Process</span><span>CPU</span><span>Memory</span></div>
            <div v-for="p in sample.terminal.top" :key="p.pid" class="cp-top-row"><span :title="`pid ${p.pid}`">{{ p.name }}</span><span>{{ pct(p.cpu) }}</span><span>{{ size(p.rssKb) }}</span></div>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>
