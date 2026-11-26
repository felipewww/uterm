<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_LABELS } from '@shared/types'
import { newTerminal, store } from '../store'

const emit = defineEmits<{ create: []; select: [id: string] }>()
async function openTerminal() { const id = await newTerminal(); if (id) emit('select', id) }

// Block-letter banner (the classic "ANSI Shadow" terminal font), built from glyphs so every row has the same width.
const FONT: Record<string, string[]> = {
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝']
}
const BANNER = Array.from({ length: 6 }, (_, row) => [...'UTERM'].map((ch) => FONT[ch]?.[row] ?? '').join('')).join('\n')

const COLS = Math.max(...BANNER.split('\n').map((l) => l.length))

const recent = computed(() => [...store.sessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, 5))
const returning = computed(() => recent.value.length > 0)

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
        <pre class="banner" aria-label="uTerm" :style="{ '--cols': COLS }">{{ BANNER }}</pre>
        <p class="tagline">Voice-enabled workspace for your coding agents</p>
      </div>

      <div class="welcome-actions">
        <button class="start-btn primary" @click="emit('create')">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3.25v9.5M3.25 8h9.5" /></svg>
          <span><strong>New session</strong><small>Start Claude Code, Codex or Kiro</small></span>
        </button>
        <button class="start-btn" title="A plain shell in your home folder" @click="openTerminal">
          <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="m4.75 6.5 1.9 1.6-1.9 1.6M8.25 9.9h3" /></svg>
          <span><strong>New terminal</strong><small>A plain shell, no agent</small></span>
        </button>
      </div>

      <div v-if="returning" class="welcome-recent">
        <div class="eyebrow">Recent sessions</div>
        <button v-for="s in recent" :key="s.id" class="recent-row" @click="emit('select', s.id)">
          <i class="dot" :class="[s.runtimeState.toLowerCase(), s.agentType]"></i>
          <span class="recent-title">{{ s.title }}</span>
          <span class="agent-tag" :class="s.agentType">{{ AGENT_LABELS[s.agentType].short }}</span>
          <span class="recent-path">{{ shortDir(s.workingDirectory) }}</span>
          <span class="recent-time">{{ ago(s.lastActivityAt) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
