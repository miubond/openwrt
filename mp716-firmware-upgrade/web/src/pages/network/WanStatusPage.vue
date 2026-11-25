<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiIcon from '@/components/UiIcon.vue'
import LoadingState from '@/components/LoadingState.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { toWanStatusView, type WanStatusView } from '@/api/view-map'
import { useToastStore } from '@/stores/toast'
import { formatLiveRateParts } from '@/utils/format'

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const refreshing = ref(false)
const status = ref<WanStatusView | null>(null)

const dnsText = computed(() => {
  const list = status.value?.dns || []
  return list.length ? list.join(t('status.dnsSep')) : '—'
})
const pending = () => t('dashboard.rateMeasuring')
const uplink = computed(() =>
  formatLiveRateParts(status.value?.txRateBps, status.value?.ratesReady, pending()),
)
const downlink = computed(() =>
  formatLiveRateParts(status.value?.rxRateBps, status.value?.ratesReady, pending()),
)

async function load(manual = false) {
  if (manual) refreshing.value = true
  else loading.value = true
  try {
    status.value = toWanStatusView(unwrap(await getRouterApi().getWanStatus()))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="wan-status">
    <div class="content">
      <header class="page-header">
        <h1>{{ t('status.wanTitle') }}</h1>
        <button type="button" class="refresh" :disabled="refreshing" @click="load(true)">
          <UiIcon name="refresh" :size="14" />
          {{ refreshing ? t('common.refreshing') : t('common.refresh') }}
        </button>
      </header>

      <LoadingState v-if="loading" />
      <template v-else-if="status">
        <section class="data-section">
          <h2>{{ t('status.basicConn') }}</h2>
          <div class="kv-grid">
            <div class="kv-item">
              <div class="kv-label">{{ t('common.mac') }}</div>
              <div class="kv-value mono">{{ status.mac || '—' }}</div>
            </div>
            <div class="kv-item">
              <div class="kv-label">{{ t('common.ip') }}</div>
              <div class="kv-value mono">{{ status.ipv4 || '—' }}</div>
            </div>
            <div class="kv-item">
              <div class="kv-label">{{ t('status.netmask') }}</div>
              <div class="kv-value mono">{{ status.netmask || '—' }}</div>
            </div>
            <div class="kv-item">
              <div class="kv-label">{{ t('status.defaultGateway') }}</div>
              <div class="kv-value mono">{{ status.gateway || '—' }}</div>
            </div>
            <div class="kv-item">
              <div class="kv-label">{{ t('status.mtu') }}</div>
              <div class="kv-value mono">{{ status.mtu ?? '—' }}</div>
            </div>
            <div class="kv-item">
              <div class="kv-label">{{ t('status.dnsServers') }}</div>
              <div class="kv-value mono">{{ dnsText }}</div>
            </div>
          </div>
        </section>

        <section class="data-section">
          <h2>{{ t('status.connTraffic') }}</h2>
          <div class="kv-grid">
            <div class="kv-item">
              <div class="kv-label">{{ t('status.connState') }}</div>
              <div class="kv-value">
                <span class="status-badge" :class="status.up ? 'ok' : 'off'">
                  <i class="status-dot" />
                  {{ status.up ? t('common.connected') : t('common.disconnected') }}
                </span>
              </div>
            </div>
            <div class="kv-item upload">
              <div class="kv-label">{{ t('status.uploadRate') }}</div>
              <div class="kv-value speed-value">
                <span class="speed-number">{{ uplink.value }}</span>
                <span v-if="uplink.unit" class="speed-unit">{{ uplink.unit }}</span>
              </div>
            </div>
            <div class="kv-item download">
              <div class="kv-label">{{ t('status.downloadRate') }}</div>
              <div class="kv-value speed-value">
                <span class="speed-number">{{ downlink.value }}</span>
                <span v-if="downlink.unit" class="speed-unit">{{ downlink.unit }}</span>
              </div>
            </div>
          </div>
        </section>
      </template>
      <p v-else class="empty">{{ t('status.emptyStatus') }}</p>
    </div>
  </div>
</template>

<style scoped>
.wan-status {
  min-height: 100%;
  padding: 32px 40px 40px;
  background: var(--color-surface);
}
.content {
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}
.page-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--color-title);
  letter-spacing: 0.5px;
  line-height: 1.3;
}
.refresh {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-title);
  font-size: 14px;
  cursor: pointer;
}
.refresh:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
.refresh:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.data-section {
  margin-bottom: 40px;
}
.data-section h2 {
  margin: 0 0 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-title);
  display: flex;
  align-items: center;
  gap: 8px;
}
.data-section h2::before {
  content: '';
  display: block;
  width: 4px;
  height: 16px;
  background: var(--color-primary);
  border-radius: 2px;
}
.kv-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px 40px;
}
.kv-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--color-border);
}
.kv-label {
  font-size: 13px;
  color: var(--color-muted);
  font-weight: 400;
}
.kv-value {
  font-size: 15px;
  color: var(--color-title);
  font-weight: 500;
  word-break: break-all;
}
.mono {
  font-family: var(--font-family-mono);
  font-weight: 500;
}
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid var(--color-border);
  font-size: 13px;
  font-weight: 500;
}
.status-badge.ok {
  background: var(--color-success-soft);
  color: var(--color-success);
  border-color: color-mix(in srgb, var(--color-success) 45%, transparent);
}
.status-badge.off {
  background: var(--color-bg-muted);
  color: var(--color-muted);
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.status-badge.ok .status-dot {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-success) 25%, transparent);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 40%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}
.speed-value {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.speed-number {
  font-size: 20px;
  font-weight: 700;
  font-family: var(--font-family-mono);
}
.speed-unit {
  font-size: 13px;
  color: var(--color-muted);
  font-weight: 400;
}
.upload .speed-number {
  color: #fa8c16;
}
.download .speed-number {
  color: var(--color-primary);
}
.empty {
  margin: 0;
  color: var(--color-muted);
}
@media (max-width: 1024px) {
  .wan-status {
    padding: 24px;
  }
  .kv-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 768px) {
  .kv-grid {
    grid-template-columns: 1fr;
  }
}
</style>
