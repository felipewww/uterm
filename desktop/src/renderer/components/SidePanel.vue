<script setup lang="ts">
import { computed, watch } from 'vue'
import { selected, store } from '../store'
import ActivityPanel from './ActivityPanel.vue'
import CommandsPanel from './CommandsPanel.vue'
import ComputerPanel from './ComputerPanel.vue'

/** The right-hand side: Activity (the agent's structured feed and the voice composer) and Computer (machine and terminal resources). */

const isShell = computed(() => selected()?.agentType === 'shell')
// A plain terminal has no agent activity: Activity is locked and Commands is the default. Agents keep their own tabs.
watch([() => selected()?.id, isShell], () => {
  if (isShell.value && store.sideTab === 'activity') store.sideTab = 'commands'
  else if (!isShell.value && store.sideTab === 'commands') store.sideTab = 'activity'
}, { immediate: true })
</script>

<template>
  <aside class="activity side">
    <div class="side-tabs" role="tablist">
      <button class="side-tab" role="tab" :aria-selected="store.sideTab === 'activity'" :class="{ active: store.sideTab === 'activity' }" :disabled="isShell" :title="isShell ? 'A plain terminal has no agent activity' : ''" @click="store.sideTab = 'activity'">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 8h2.2l1.6-4.5 3.4 9 1.6-4.5h2.2" /></svg>Activity
      </button>
      <button class="side-tab" role="tab" :aria-selected="store.sideTab === 'commands'" :class="{ active: store.sideTab === 'commands' }" :disabled="!isShell" :title="!isShell ? 'Saved commands are for plain terminals' : ''" @click="store.sideTab = 'commands'">
        <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3.5 5.5 2.5 2.5-2.5 2.5M8 11h4.5" /></svg>Commands
      </button>
      <button class="side-tab" role="tab" :aria-selected="store.sideTab === 'computer'" :class="{ active: store.sideTab === 'computer' }" @click="store.sideTab = 'computer'">
        <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2.5" y="3" width="11" height="7.5" rx="1.25" /><path d="M6 13h4M8 10.5V13" /></svg>Computer
      </button>
    </div>
    <ActivityPanel v-show="store.sideTab === 'activity'" />
    <CommandsPanel v-if="store.sideTab === 'commands'" />
    <ComputerPanel v-if="store.sideTab === 'computer'" />
  </aside>
</template>
