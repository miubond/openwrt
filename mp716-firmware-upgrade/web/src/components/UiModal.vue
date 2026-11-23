<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    danger?: boolean
    /** sm=420 confirm dialogs；md=520 forms */
    size?: 'sm' | 'md'
    confirmLabel?: string
    cancelLabel?: string
    confirmDisabled?: boolean
  }>(),
  {
    danger: false,
    size: 'sm',
    confirmDisabled: false,
  },
)
const emit = defineEmits<{ close: []; confirm: [] }>()

const { t } = useI18n()

function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  },
  { immediate: true },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mask" @click.self="emit('close')">
      <div class="dialog" :class="`dialog--${size}`" role="dialog" aria-modal="true" @click.stop>
        <header class="head">
          <h3 class="title">{{ title }}</h3>
          <button class="close" type="button" :aria-label="t('common.cancel')" @click="emit('close')">
            ×
          </button>
        </header>
        <div class="content">
          <slot />
        </div>
        <footer class="foot">
          <button type="button" class="btn sec" @click="emit('close')">
            {{ cancelLabel || t('common.cancel') }}
          </button>
          <button
            type="button"
            class="btn"
            :class="danger ? 'danger' : 'pri'"
            :disabled="confirmDisabled"
            @click="emit('confirm')"
          >
            <slot name="confirm-label">{{ confirmLabel || t('common.confirm') }}</slot>
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: grid;
  place-items: center;
  z-index: var(--z-modal, 300);
  padding: 1rem;
}
.dialog {
  width: min(420px, 100%);
  background: var(--color-surface);
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  padding: 1.1rem;
  color: var(--color-title);
}
.content {
  color: var(--color-text);
  margin: 0.75rem 0 1.1rem;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
button {
  border-radius: 6px;
  border: 1px solid transparent;
  padding: 0.45rem 0.85rem;
  cursor: pointer;
}
.sec {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-title);
}
.pri {
  background: var(--color-primary);
  color: #fff;
}
.danger {
  background: var(--color-danger);
  color: #fff;
}

.dialog { max-height: min(90vh, 720px); overflow-y: auto; }
.dialog--md { width: min(520px, 100%); }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.title { margin: 0; font-size: var(--fs-md); line-height: var(--lh-tight); }
.close { border: 0; padding: 0 4px; background: transparent; color: var(--color-muted); font-size: 22px; }
.close:hover { color: var(--color-title); }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.foot { flex-wrap: wrap; }
</style>
