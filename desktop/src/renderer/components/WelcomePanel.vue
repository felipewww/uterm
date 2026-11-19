<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../store'

const emit = defineEmits<{ create: []; select: [id: string] }>()

// Minimal line-art cat: light outline, dark face, slit yellow eyes. Drawn in a 415x410 box (axis x = 767.5); the left half is mirrored.
const AXIS = 767.5
const mirrorX = (x: number) => 2 * AXIS - x
const LEFT_OUTLINE: Array<[number, number]> = [
  [AXIS, 394], [745, 395], [696, 410], [600, 320], [584, 408], [590, 482], [572, 537], [600, 570], [672, 634], [AXIS, 685]
]
const OUTLINE = [...LEFT_OUTLINE, ...LEFT_OUTLINE.slice(1, -1).reverse().map(([x, y]): [number, number] => [mirrorX(x), y])]
  .map(([x, y]) => `${x},${y}`).join(' ')
const SIDES = [{ id: 'l', transform: undefined }, { id: 'r', transform: `translate(${2 * AXIS} 0) scale(-1 1)` }]

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
      <div class="brand-row">
        <svg class="cat" viewBox="555 305 425 400" role="img" aria-label="Echo-Term cat">
          <polygon class="cat-face" :points="OUTLINE" />
          <g v-for="side in SIDES" :key="side.id" :transform="side.transform">
            <path class="cat-whisker" d="M572,588 Q630,578 684,590 M585,625 Q640,605 684,606 M610,659 Q650,640 676,632" />
            <g class="eye">
              <path class="eye-fill" d="M649,502 L738,548 Q714,564 684,558 Q655,542 649,502 Z" />
              <polygon class="eye-pupil" points="691,514 684,549 697,552" />
            </g>
          </g>
          <polygon class="cat-nose" points="746,592 789,592 767.5,613" />
          <path class="cat-whisker thick" d="M767.5,613 V628" />
        </svg>
        <div class="brand-text">
          <span class="wordmark" aria-label="echo-term"><span class="wm-prompt" aria-hidden="true">❯</span><span class="wm-echo">echo</span><span class="wm-dash">-</span><span class="wm-term">term</span><span class="wm-cursor" aria-hidden="true"></span></span>
          <span class="tagline">Voice-enabled workspace for Claude Code and Codex</span>
        </div>
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
          <span class="agent-tag" :class="s.agentType">{{ s.agentType === 'claude' ? 'Claude' : 'Codex' }}</span>
          <span class="recent-path">{{ shortDir(s.workingDirectory) }}</span>
          <span class="recent-time">{{ ago(s.lastActivityAt) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
