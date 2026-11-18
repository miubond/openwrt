<script setup lang="ts">
import { computed } from 'vue'
import { iconMap, type IconName } from './icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    size?: number
    strokeWidth?: number
  }>(),
  { size: 20, strokeWidth: 1.8 },
)

const Comp = computed(() => iconMap[props.name])
</script>

<template>
  <component
    :is="Comp"
    class="ico"
    :size="size"
    :stroke-width="strokeWidth"
    aria-hidden="true"
  />
</template>

<style scoped>
.ico {
  display: block;
  flex-shrink: 0;
}
</style>
