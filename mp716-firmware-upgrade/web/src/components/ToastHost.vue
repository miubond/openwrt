<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { AlertTriangle, CheckCircle2, Info, XCircle } from '@lucide/vue'
import { useToastStore, type ToastKind } from '@/stores/toast'

const toast = useToastStore()
const { items } = storeToRefs(toast)

const iconByKind: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

function iconOf(kind: ToastKind) {
  return iconByKind[kind]
}

const hasItems = computed(() => items.value.length > 0)
</script>

<template>
  <div class="host" :class="{ empty: !hasItems }" aria-live="polite" aria-relevant="additions">
    <div
      v-for="t in items"
      :key="t.id"
      class="toast"
      :class="t.kind"
      role="status"
      @click="toast.dismiss(t.id)"
    >
      <span class="ico" aria-hidden="true">
        <component :is="iconOf(t.kind)" :size="16" :stroke-width="2.2" />
      </span>
      <span class="msg">{{ t.message }}</span>
    </div>
  </div>
</template>

<style scoped>
.host {
  position: fixed;
  top: calc(56px + env(safe-area-inset-top, 0px) + 20px);
  left: 50%;
  z-index: var(--z-toast, 400);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(420px, calc(100vw - 32px));
  transform: translateX(-50%);
  pointer-events: none;
}

.host.empty {
  display: none;
}

.toast {
  pointer-events: auto;
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  width: max-content;
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: var(--color-surface);
  color: var(--color-title);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06);
  cursor: pointer;
  animation: toast-in 0.22s ease-out;
}

.msg {
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
  font-weight: var(--fw-medium);
  word-break: break-word;
}

.ico {
  display: grid;
  place-items: center;
  margin-top: 1px;
  flex-shrink: 0;
}

.success {
  background: var(--color-success-soft);
  border-color: color-mix(in srgb, var(--color-success) 28%, transparent);
  color: #0f7a28;
}

.success .ico {
  color: var(--color-success);
}

.error {
  background: var(--color-danger-soft);
  border-color: color-mix(in srgb, var(--color-danger) 28%, transparent);
  color: #c81e1e;
}

.error .ico {
  color: var(--color-danger);
}

.warning {
  background: var(--color-warning-soft);
  border-color: color-mix(in srgb, var(--color-warning) 28%, transparent);
  color: #b35a00;
}

.warning .ico {
  color: var(--color-warning);
}

.info {
  background: var(--color-primary-soft);
  border-color: color-mix(in srgb, var(--color-primary) 28%, transparent);
  color: var(--color-title);
}

.info .ico {
  color: var(--color-primary);
}

html.dark .success {
  color: #86efac;
}

html.dark .error {
  color: #fca5a5;
}

html.dark .warning {
  color: #fcd34d;
}

html.dark .toast {
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 640px) {
  .host {
    top: calc(56px + env(safe-area-inset-top, 0px) + 12px);
    width: min(360px, calc(100vw - 24px));
    max-width: none;
  }

  .toast {
    width: 100%;
    justify-content: center;
  }
}
</style>
