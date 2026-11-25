<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type UiSelectOption = { value: string | number; label: string }

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: UiSelectOption[]
    placeholder?: string
    ariaLabel?: string
    disabled?: boolean
  }>(),
  { placeholder: '', ariaLabel: undefined, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const currentLabel = computed(() => {
  const hit = props.options.find((o) => o.value === props.modelValue)
  return hit?.label || props.placeholder || String(props.modelValue ?? '')
})

const isPlaceholder = computed(() => {
  if (!props.placeholder) return false
  return !props.options.some((o) => o.value === props.modelValue)
})

function placeMenu() {
  const el = root.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth
  const gap = 4
  const maxH = Math.min(256, Math.max(120, viewportH - 24))
  const spaceBelow = viewportH - rect.bottom - gap - 8
  const spaceAbove = rect.top - gap - 8
  const openUp = spaceBelow < 160 && spaceAbove > spaceBelow
  const height = Math.min(maxH, openUp ? spaceAbove : spaceBelow)
  const width = Math.max(rect.width, 112)
  let left = rect.left
  if (left + width > viewportW - 8) left = Math.max(8, viewportW - width - 8)
  if (left < 8) left = 8

  menuStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${Math.max(96, height)}px`,
    zIndex: '500',
    ...(openUp
      ? { bottom: `${viewportH - rect.top + gap}px`, top: 'auto' }
      : { top: `${rect.bottom + gap}px`, bottom: 'auto' }),
  }
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    await nextTick()
    placeMenu()
  }
}

function choose(value: string | number) {
  emit('update:modelValue', value)
  open.value = false
}

function onDocPointer(e: PointerEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (root.value?.contains(t) || menu.value?.contains(t)) return
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

function onReposition() {
  if (open.value) placeMenu()
}

watch(open, async (v) => {
  if (!v) return
  await nextTick()
  placeMenu()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer)
  document.addEventListener('keydown', onKey)
  window.addEventListener('resize', onReposition)
  window.addEventListener('scroll', onReposition, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onReposition)
  window.removeEventListener('scroll', onReposition, true)
})
</script>

<template>
  <div ref="root" class="ui-select" :class="{ open, disabled }">
    <button
      class="ui-select-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-label="ariaLabel || placeholder || currentLabel"
      @click="toggle"
    >
      <span class="ui-select-value" :class="{ placeholder: isPlaceholder }">
        {{ isPlaceholder ? placeholder : currentLabel }}
      </span>
      <span class="ui-select-caret" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <ul
        v-show="open"
        ref="menu"
        class="ui-select-menu"
        role="listbox"
        :style="menuStyle"
      >
        <li
          v-for="opt in options"
          :key="String(opt.value)"
          class="ui-select-option"
          role="option"
          :aria-selected="opt.value === modelValue"
          :class="{ active: opt.value === modelValue }"
          @click="choose(opt.value)"
        >
          {{ opt.label }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.ui-select {
  position: relative;
  min-width: 112px;
  max-width: 320px;
}

.ui-select.disabled {
  opacity: 0.55;
  pointer-events: none;
}

.ui-select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  padding: 4px 10px 4px 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-title);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  cursor: pointer;
  transition:
    border-color 0.2s,
    box-shadow 0.2s,
    background 0.2s;
}

.ui-select-trigger:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.ui-select.open .ui-select-trigger,
.ui-select-trigger:focus-visible {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent);
}

.ui-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.ui-select-value.placeholder {
  color: var(--color-muted);
}

.ui-select-caret {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-right: 2px;
  border-right: 1.5px solid var(--color-muted);
  border-bottom: 1.5px solid var(--color-muted);
  transform: rotate(45deg) translateY(-1px);
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.ui-select.open .ui-select-caret {
  transform: rotate(225deg) translateY(-1px);
  border-color: var(--color-primary);
}

.ui-select-trigger:hover:not(:disabled) .ui-select-caret {
  border-color: var(--color-primary);
}
</style>

<style>
/* Teleport 到 body，避免被 app-main / settings-form overflow 裁切 */
.ui-select-menu {
  margin: 0;
  padding: 4px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  box-shadow: var(--shadow-menu);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--color-muted) 45%, transparent) transparent;
}

.ui-select-menu::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}

.ui-select-option {
  padding: 5px 12px;
  border-radius: 4px;
  color: var(--color-text);
  font-size: var(--fs-base);
  line-height: 22px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.ui-select-option:hover {
  background: var(--color-bg-soft);
  color: var(--color-title);
}

.ui-select-option.active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: var(--fw-medium);
}

.ui-select-option.active:hover {
  background: var(--color-primary-soft);
}
</style>
