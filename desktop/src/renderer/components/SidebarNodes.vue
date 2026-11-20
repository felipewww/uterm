<script setup lang="ts">
import { inject } from 'vue'
import { store } from '../store'
import AgentIcon from './AgentIcon.vue'
import type { SidebarNode } from './sidebarTypes'

/**
 * One level of the sessions tree (it calls itself for folders). The state and handlers live in SessionSidebar and are shared through
 * `sbx`, so this file is only markup. A folder is a bordered container: its header and everything inside share one background.
 */
defineOptions({ name: 'SidebarNodes' })
defineProps<{ nodes: SidebarNode[] }>()
 
const c = inject('sbx') as any
</script>

<template>
  <template v-for="n in nodes" :key="n.key">
    <!-- folder: header + body in one container -->
    <div
      v-if="n.kind === 'folder'" class="sb-folder" :class="{ drop: c.dropKey === n.key, dragging: c.dragId === n.id }"
      @dragover="c.onDragOver($event, n.key, n.id)" @dragleave="c.dropKey = null" @drop="c.onDrop($event, n.id)"
    >
      <div
        class="sb-folder-head" role="button" tabindex="-1" :aria-expanded="!n.collapsed" :draggable="c.editingFolder !== n.id"
        @click="c.collapsed[n.key] = !n.collapsed" @contextmenu.prevent="c.openFolderMenu($event, n)" @dblclick.stop="c.startRenameFolder(n.id, n.name)"
        @dragstart="c.onDragStart($event, 'folder', n.id)" @dragend="c.onDragEnd"
      >
        <svg class="sb-chev" :class="{ collapsed: n.collapsed }" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
        <svg class="sb-folder-ico" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.25h4l1.5 1.75H14v6.5H2z" /></svg>
        <input v-if="c.editingFolder === n.id" v-model="c.folderText" class="rename sb-folder-input" aria-label="Folder name" @click.stop @dblclick.stop @keydown.enter="c.commitRenameFolder" @keydown.esc.stop="c.editingFolder = null" @blur="c.commitRenameFolder" />
        <span v-else class="sb-folder-name">{{ n.name }}</span>
        <span class="sb-count">{{ n.count }}</span>
      </div>
      <div v-if="!n.collapsed && n.children.length" class="sb-folder-body"><SidebarNodes :nodes="n.children" /></div>
    </div>

    <!-- a folder being named -->
    <div v-else-if="n.kind === 'new'" class="sb-folder">
      <div class="sb-folder-head">
        <svg class="sb-chev" aria-hidden="true" viewBox="0 0 16 16"><path d="m4.5 6.25 3.5 3.5 3.5-3.5" /></svg>
        <svg class="sb-folder-ico" aria-hidden="true" viewBox="0 0 16 16"><path d="M2 4.25h4l1.5 1.75H14v6.5H2z" /></svg>
        <input v-if="c.newFolder" v-model="c.newFolder.text" class="rename sb-folder-input" placeholder="Folder name" aria-label="New folder name" @keydown.enter="c.commitNewFolder" @keydown.esc.stop="c.newFolder = null" @blur="c.commitNewFolder" />
      </div>
    </div>

    <div v-else-if="n.kind === 'empty'" class="sb-empty" :class="{ drop: c.dropKey === n.key }" @dragover="c.onDragOver($event, n.key, n.folderId)" @dragleave="c.dropKey = null" @drop="c.onDrop($event, n.folderId)">Empty. Drag items here.</div>

    <!-- session card -->
    <div
      v-else class="sb-card" role="option" draggable="true" :aria-selected="n.s.id === store.selectedId" :data-sid="n.s.id" :title="c.tip(n.s)"
      :class="['st-' + n.s.runtimeState.toLowerCase(), { live: n.s.running, closed: !n.s.running, selected: n.s.id === store.selectedId, attention: n.s.needsAttention, dragging: c.dragId === n.s.id }]"
      @click="c.select(n.s.id)" @dblclick.stop="c.startEdit(n.s)" @dragstart="c.onDragStart($event, 'session', n.s.id)" @dragend="c.onDragEnd" @contextmenu.prevent="c.openMenu($event, n.s)"
    >
      <i class="sb-dot"></i>
      <div class="sb-main">
        <div class="sb-line">
          <input v-if="c.editingId === n.s.id" v-model="c.editText" class="rename sb-edit-input" @click.stop @dblclick.stop @keydown.enter="c.commitEdit" @keydown.esc.stop="c.editingId = null" @blur="c.commitEdit" />
          <span v-else class="sb-title">{{ n.s.title }}</span>
          <span v-if="n.s.speaking" class="speaking" title="Speaking"><span class="eq"><i></i><i></i><i></i></span></span>
          <svg v-else-if="n.s.muted" class="muted-icon" aria-label="Muted" viewBox="0 0 16 16"><path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11.5 6l3 4M14.5 6l-3 4" /></svg>
          <span class="sb-time">{{ c.ago(n.s.lastActivityAt) }}</span>
          <span class="sb-actions" @click.stop>
            <button v-if="n.s.running" class="icon-btn small" title="Stop session (keeps history)" aria-label="Stop session" @click="c.close(n.s)">
              <svg aria-hidden="true" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1" /></svg>
            </button>
            <button class="icon-btn small danger" title="Delete session" aria-label="Delete session" @click="c.remove(n.s)">
              <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 4.75h10M6 4.75V3.25h4v1.5M4.5 4.75l.55 8.25h5.9l.55-8.25M6.75 7v3.75M9.25 7v3.75" /></svg>
            </button>
          </span>
        </div>
        <div class="sb-sub">
          <AgentIcon :agent="n.s.agentType" class="sb-agent-ico" />
          <span class="sb-agent">{{ c.agentName(n.s) }}</span>
          <span class="sb-path">{{ c.shortDir(n.s.workingDirectory) }}</span>
          <span v-if="c.statusText(n.s)" class="sb-state" :class="c.statusTone(n.s)">{{ c.statusText(n.s) }}</span>
        </div>
      </div>
    </div>
  </template>
</template>
