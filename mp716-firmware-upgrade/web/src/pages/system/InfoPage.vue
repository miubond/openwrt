<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiIcon from '@/components/UiIcon.vue'
import LoadingState from '@/components/LoadingState.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import type { DeviceInfo } from '@/api'
import type { IconName } from '@/components/icons'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const refreshing = ref(false)
const info = ref<DeviceInfo | null>(null)

function show(value: string) {
  const raw = value.trim()
  return raw ? raw : '—'
}

type InfoItem = {
  key: string
  label: string
  value: string
  icon: IconName
  mono?: boolean
}

const softwareItems = computed((): InfoItem[] => {
  const data = info.value
  if (!data) return []
  return [
    {
      key: 'software',
      label: t('sysInfo.softwareVersion'),
      value: show(data.softwareVersion),
      icon: 'upgrade',
    },
    {
      key: 'webui',
      label: t('sysInfo.webuiVersion'),
      value: show(data.webuiVersion),
      icon: 'overview',
    },
  ]
})

const networkItems = computed((): InfoItem[] => {
  const data = info.value
  if (!data) return []
  return [
    {
      key: 'lanMac',
      label: t('sysInfo.lanMac'),
      value: show(data.lanMac),
      icon: 'lan',
      mono: true,
    },
    {
      key: 'wanIp',
      label: t('sysInfo.wanIp'),
      value: show(data.wanIp),
      icon: 'globe',
      mono: true,
    },
  ]
})

async function load() {
  loading.value = true
  try {
    info.value = unwrap(await getRouterApi().getDeviceInfo())
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    info.value = unwrap(await getRouterApi().getDeviceInfo())
    toast.success(t('sysInfo.refreshOk'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    refreshing.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="info-page">
    <LoadingState v-if="loading" />
    <UiCard v-else-if="info" icon="info" :title="t('nav.sysInfo')">
      <template #actions>
        <button
          class="icon-action"
          type="button"
          :disabled="refreshing"
          :title="refreshing ? t('sysInfo.refreshing') : t('sysInfo.refresh')"
          :aria-label="refreshing ? t('sysInfo.refreshing') : t('sysInfo.refresh')"
          @click="refresh"
        >
          <UiIcon class="refresh-ico" :class="{ spin: refreshing }" name="refresh" :size="18" />
        </button>
      </template>

      <div class="hero">
        <div class="hero-ico" aria-hidden="true">
          <UiIcon name="router" :size="28" />
        </div>
        <div class="hero-text">
          <h2 class="hero-name">{{ show(info.productName) }}</h2>
          <p class="hero-model">
            <span class="model-label">{{ t('sysInfo.productModel') }}</span>
            <span class="model-value">{{ show(info.productModel) }}</span>
          </p>
        </div>
      </div>

      <section class="group">
        <h3 class="group-title">{{ t('sysInfo.sectionSoftware') }}</h3>
        <div class="tiles">
          <div v-for="item in softwareItems" :key="item.key" class="tile">
            <div class="tile-ico"><UiIcon :name="item.icon" :size="16" /></div>
            <div class="tile-body">
              <span class="tile-label">{{ item.label }}</span>
              <strong class="tile-value">{{ item.value }}</strong>
            </div>
          </div>
        </div>
      </section>

      <section class="group">
        <h3 class="group-title">{{ t('sysInfo.sectionNetwork') }}</h3>
        <div class="tiles">
          <div v-for="item in networkItems" :key="item.key" class="tile">
            <div class="tile-ico"><UiIcon :name="item.icon" :size="16" /></div>
            <div class="tile-body">
              <span class="tile-label">{{ item.label }}</span>
              <strong class="tile-value" :class="{ mono: item.mono }">{{ item.value }}</strong>
            </div>
          </div>
        </div>
      </section>
    </UiCard>
  </div>
</template>

<style scoped>
.info-page {
  width: 100%;
}

.info-page :deep(.head) {
  align-items: center;
}

@media (max-width: 640px) {
  .info-page :deep(.head) {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .info-page :deep(.titles) {
    min-width: 0;
    flex: 1;
  }

  .info-page :deep(.actions) {
    width: auto;
    flex-shrink: 0;
  }
}

.icon-action {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  color: var(--color-primary);
  background: transparent;
  cursor: pointer;
}

.icon-action:hover:not(:disabled) {
  background: var(--color-primary-soft);
}

.icon-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.refresh-ico.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 18px;
  margin-bottom: 20px;
  border-radius: 12px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 10%, transparent), transparent 62%),
    var(--color-bg-soft);
  border: 1px solid var(--color-border);
}

.hero-ico {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  flex-shrink: 0;
}

.hero-text {
  min-width: 0;
}

.hero-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--color-title);
  word-break: break-word;
}

.hero-model {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  line-height: 1.4;
}

.model-label {
  color: var(--color-muted);
}

.model-value {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-title);
  font-weight: 600;
}

.group {
  margin-bottom: 18px;
}

.group:last-child {
  margin-bottom: 0;
}

.group-title {
  margin: 0 0 10px;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--color-muted);
  letter-spacing: 0.02em;
}

.tiles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.tile {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 14px 14px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface);
  min-width: 0;
}

.tile-ico {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  flex-shrink: 0;
}

.tile-body {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.tile-label {
  color: var(--color-muted);
  font-size: var(--fs-xs);
  line-height: 1.3;
}

.tile-value {
  color: var(--color-title);
  font-size: var(--fs-base);
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
}

.mono {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

@media (max-width: 640px) {
  .hero {
    padding: 14px;
  }

  .hero-name {
    font-size: 18px;
  }

  .tiles {
    grid-template-columns: 1fr;
  }
}
</style>
