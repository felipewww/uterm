<script setup lang="ts">
// Vertical drag handle that lives in the gap between two panels. Emits pixel deltas; the parent owns the sizes.
const props = defineProps<{ label: string }>()
const emit = defineEmits<{ resize: [delta: number]; reset: [] }>()

function down(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  el.classList.add('dragging')
  document.body.classList.add('resizing')
  let last = e.clientX
  const move = (ev: PointerEvent) => { emit('resize', ev.clientX - last); last = ev.clientX }
  const up = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
    el.classList.remove('dragging'); document.body.classList.remove('resizing')
  }
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
}
function key(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') { e.preventDefault(); emit('resize', -16) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); emit('resize', 16) }
  else if (e.key === 'Enter') emit('reset')
}
</script>

<template>
  <div class="resize-handle" role="separator" aria-orientation="vertical" tabindex="0" :aria-label="props.label"
    title="Drag to resize · double-click to reset" @pointerdown.prevent="down" @dblclick="emit('reset')" @keydown="key"></div>
</template>
