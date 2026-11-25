<script setup lang="ts">
import { ref } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ToastHost from '@/components/ToastHost.vue'

const router = useRouter()
const { t } = useI18n()
/** 首屏路由守卫会 await prelogin/ping；在 isReady 前保持启动页，避免白屏 */
const bootReady = ref(false)

void router.isReady().finally(() => {
  bootReady.value = true
  document.getElementById('mp716-boot-style')?.remove()
})
</script>

<template>
  <div v-if="!bootReady" class="app-boot" role="status" aria-live="polite">
    <div class="boot-panel">
      <p class="brand">{{ t('brand.title') }}</p>
      <p class="sub">{{ t('brand.sub') }}</p>
      <span class="spinner" aria-hidden="true" />
      <p class="hint">{{ t('common.loading') }}</p>
    </div>
  </div>
  <template v-else>
    <RouterView />
    <ToastHost />
  </template>
</template>

<style scoped>
.app-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  padding: 1.5rem;
  box-sizing: border-box;
  color: var(--color-muted);
  background:
    radial-gradient(ellipse 70% 50% at 50% 35%, color-mix(in srgb, var(--color-primary) 12%, transparent), transparent 70%),
    radial-gradient(ellipse 90% 70% at 50% 100%, color-mix(in srgb, var(--color-header) 6%, transparent), transparent 65%),
    var(--color-bg);
}

.boot-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  animation: boot-in 0.35s ease-out;
}

.brand {
  margin: 0;
  color: var(--color-header);
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.1;
}

.sub {
  margin: 0 0 0.85rem;
  color: var(--color-muted);
  font-size: 0.8125rem;
  letter-spacing: 0.12em;
}

.spinner {
  width: 2rem;
  height: 2rem;
  border: 2.5px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-border));
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation:
    spin 0.75s linear infinite,
    pulse 1.6s ease-in-out infinite;
}

.hint {
  margin: 0.35rem 0 0;
  font-size: 0.8125rem;
  letter-spacing: 0.04em;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 28%, transparent);
  }
  50% {
    opacity: 0.85;
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent);
  }
}

@keyframes boot-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

:global(html.dark) .brand,
:global(html[data-theme='dark']) .brand {
  color: var(--color-title);
}
</style>
