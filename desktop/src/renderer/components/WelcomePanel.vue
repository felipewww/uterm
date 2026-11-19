<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_LABELS } from '@shared/types'
import { store } from '../store'

const emit = defineEmits<{ create: []; select: [id: string] }>()

// Block-letter banner (the classic "ANSI Shadow" terminal font), built from glyphs so every row has the same width.
const FONT: Record<string, string[]> = {
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝']
}
const BANNER = Array.from({ length: 6 }, (_, row) => [...'ECHOTERM'].map((ch) => FONT[ch]?.[row] ?? '').join('')).join('\n')

const recent = computed(() => store.sessions.filter((s) => !s.archivedAt).sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 5))
const returning = computed(() => recent.value.length > 0)
const last = computed(() => recent.value[0])

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`
}
const shortDir = (p: string) => {
  const parts = p.replace(/^\/home\/[^/]+/, '~').split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : parts.join('/') || '/'
}
</script>

<template>
  <div class="welcome">
    <div class="welcome-inner">
      <div class="brand">
        <pre class="banner" aria-label="Echo-Term">{{ BANNER }}</pre>
        <p class="tagline">Voice-enabled workspace for your coding agents</p>
      </div>

      <div class="welcome-head">
        <h1>{{ returning ? 'Welcome back' : 'Welcome' }}</h1>
        <p>{{ returning ? 'Pick up where you left off, or start something new.' : 'Start a session in any project folder. Everything stays on this machine.' }}</p>
      </div>

      <div class="welcome-actions">
        <button class="btn primary" @click="emit('create')">New session</button>
        <button v-if="last" class="btn" :title="`Open ${last.title}`" @click="emit('select', last.id)">Open last session</button>
      </div>

      <div v-if="returning" class="welcome-recent">
        <div class="eyebrow">Recent sessions</div>
        <button v-for="s in recent" :key="s.id" class="recent-row" @click="emit('select', s.id)">
          <i class="dot" :class="s.runtimeState.toLowerCase()"></i>
          <span class="recent-title">{{ s.title }}</span>
          <span class="agent-tag" :class="s.agentType">{{ AGENT_LABELS[s.agentType].short }}</span>
          <span class="recent-path">{{ shortDir(s.workingDirectory) }}</span>
          <span class="recent-time">{{ ago(s.lastActivityAt) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
