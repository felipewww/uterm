<script setup lang="ts">
import { BOX_COLORS, COLOR_PRESETS, boxColors, setBoxColor, type BoxColor } from '../design/theme'

const current = (id: BoxColor, fallback: string) => boxColors.value[id] ?? fallback
</script>

<template>
  <h3 class="pane-title">Gradient colors</h3>
  <p class="colors-note">The strongest color of each box's light. Changes apply at once and are kept on this computer.</p>
  <div v-for="c in BOX_COLORS" :key="c.id" class="color-row">
    <div class="color-head">
      <i class="color-sample" :style="{ '--sample': current(c.id, c.fallback) }"></i>
      <span class="color-text"><strong>{{ c.label }}</strong><small>{{ c.hint }}</small></span>
      <button class="btn small" :disabled="!boxColors[c.id]" @click="setBoxColor(c.id, null)">Reset</button>
    </div>
    <div class="color-choices" role="radiogroup" :aria-label="c.label">
      <button v-for="p in COLOR_PRESETS" :key="p" class="color-dot" role="radio" :aria-checked="current(c.id, c.fallback) === p" :aria-label="p" :style="{ background: p }" @click="setBoxColor(c.id, p)"></button>
      <label class="color-custom" title="Pick any color">
        <input type="color" :value="current(c.id, c.fallback)" :aria-label="`Custom color for ${c.label}`" @input="setBoxColor(c.id, ($event.target as HTMLInputElement).value)" />Custom
      </label>
    </div>
  </div>
</template>
