<script setup lang="ts">
import type { AgentType } from '@shared/types'

/**
 * Small line-art marks that tell the agents apart at a glance. They are simple original glyphs in each agent's colour
 * (not the vendors' official logos): a sunburst for Claude, a prompt for Codex, a ghost for Kiro, a small terminal window for a plain shell.
 */
defineProps<{ agent: AgentType }>()
</script>

<template>
  <svg class="agent-icon" :class="agent" viewBox="0 0 16 16" aria-hidden="true">
    <path v-if="agent === 'claude'" d="M8 1.75v4M8 10.25v4M1.75 8h4M10.25 8h4M3.6 3.6l2.8 2.8M9.6 9.6l2.8 2.8M12.4 3.6 9.6 6.4M6.4 9.6 3.6 12.4" />
    <template v-else-if="agent === 'codex'"><path d="M3 5 7 8.25 3 11.5" /><path d="M8.75 11.75h4.25" /></template>
    <template v-else-if="agent === 'shell'"><rect x="2" y="3" width="12" height="10" rx="1.75" /><path d="m4.75 6.5 1.9 1.6-1.9 1.6M8.25 9.9h3" /></template>
    <template v-else><path d="M3.75 13.5V7.25a4.25 4.25 0 0 1 8.5 0v6.25l-1.4-1.1-1.45 1.1-1.4-1.1-1.4 1.1-1.45-1.1z" /><path d="M6.25 7.25h.01M9.75 7.25h.01" /></template>
  </svg>
</template>
