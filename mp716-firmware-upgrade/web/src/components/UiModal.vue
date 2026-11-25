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
  max-height: min(90vh, 720px);
  overflow: auto;
  background: var(--color-surface);
  border-radius: 12px;
  border: 1px solid var(--color-border);
  color: var(--color-title);
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2);
}
.dialog--md {
  width: min(520px, 100%);
}
.head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: start;
  padding: 18px 48px 12px 24px;
  border-bottom: 1px solid var(--color-border);
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-title);
}
.close {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.close:hover {
  color: var(--color-title);
  background: var(--color-bg-muted);
}
.content {
  color: var(--color-text);
  padding: 16px 24px 8px;
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 24px;
  border-top: 1px solid var(--color-border);
}
.btn {
  appearance: none;
  min-width: 88px;
  min-height: 36px;
  border-radius: 999px;
  border: 1px solid transparent;
  padding: 8px 20px;
  cursor: pointer;
  touch-action: manipulation;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.sec {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-title);
}
.sec:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.pri {
  background: var(--color-primary);
  color: #fff;
}
.pri:hover:not(:disabled) {
  background: var(--color-primary-hover);
}
.danger {
  background: var(--color-danger);
  color: #fff;
}
</style>
