<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiIcon from '@/components/UiIcon.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { DeviceRouterAdapter } from '@/api/adapters/device-adapter'
import { toDeviceView, type DeviceView } from '@/api/view-map'
import { useToastStore } from '@/stores/toast'
import type { DeviceAclEntry } from '@/api/types'

const POLL_MS = import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? 15_000 : 6000

type DeviceRow = DeviceView

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const devices = ref<DeviceRow[]>([])
const aclEntries = ref<DeviceAclEntry[]>([])
const factoryTab = ref<'online' | 'acl'>('online')
const aclBusyMac = ref<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | undefined

const aclMacSet = computed(() => new Set(aclEntries.value.map((e) => e.mac.toLowerCase())))

async function loadDevices() {
  const list = unwrap(await getRouterApi().getConnectedDevices())
  devices.value = list.map((d) => toDeviceView(d))
}

async function loadAcl() {
  aclEntries.value = unwrap(await getRouterApi().getDeviceAclList())
}

async function loadHostsData() {
  const api = getRouterApi()
  if (api instanceof DeviceRouterAdapter) {
    const overview = unwrap(await api.getHostsOverview())
    devices.value = overview.connected.map((d) => toDeviceView(d))
    aclEntries.value = overview.acl
    return
  }
  await Promise.all([loadDevices(), loadAcl()])
}

async function load() {
  loading.value = true
  try {
    await loadHostsData()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function refreshQuiet() {
  try {
    await loadHostsData()
  } catch {
    /* poll errors are silent */
  }
}

async function addToAcl(mac: string) {
  if (aclBusyMac.value) return
  aclBusyMac.value = mac
  try {
    unwrap(await getRouterApi().addDeviceAcl(mac))
    toast.success(t('devices.addedToAcl'))
    await refreshQuiet()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    aclBusyMac.value = null
  }
}

async function removeFromAcl(mac: string) {
  if (aclBusyMac.value) return
  aclBusyMac.value = mac
  try {
    unwrap(await getRouterApi().removeDeviceAcl(mac))
    toast.success(t('devices.removedFromAcl'))
    await refreshQuiet()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    aclBusyMac.value = null
  }
}

function isInAcl(mac: string) {
  return aclMacSet.value.has(mac.toLowerCase())
}

onMounted(() => {
  void load()
  pollTimer = setInterval(() => void refreshQuiet(), POLL_MS)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="devices-page">
    <LoadingState v-if="loading" />
    <template v-else>
      <div class="factory-tabs">
        <button
          type="button"
          class="factory-tab"
          :class="{ active: factoryTab === 'online' }"
          @click="factoryTab = 'online'"
        >
          {{ t('devices.onlineList') }}
        </button>
        <button
          type="button"
          class="factory-tab"
          :class="{ active: factoryTab === 'acl' }"
          @click="factoryTab = 'acl'"
        >
          {{ t('devices.aclList') }}
        </button>
      </div>

      <UiCard>
        <template v-if="factoryTab === 'online'">
          <EmptyState v-if="!devices.length" :title="t('common.emptyOnline')" />
          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('common.ip') }}</th>
                  <th>{{ t('common.mac') }}</th>
                  <th>{{ t('common.hostname') }}</th>
                  <th>{{ t('common.action') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in devices" :key="d.id">
                  <td>{{ d.ip || '—' }}</td>
                  <td class="mac">{{ d.mac }}</td>
                  <td>{{ d.name || '—' }}</td>
                  <td>
                    <button
                      type="button"
                      class="icon-action"
                      :disabled="aclBusyMac === d.mac || isInAcl(d.mac)"
                      :title="isInAcl(d.mac) ? t('devices.alreadyInAcl') : t('devices.addToAcl')"
                      @click="addToAcl(d.mac)"
                    >
                      <UiIcon name="lock" :size="18" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>

        <template v-else>
          <EmptyState v-if="!aclEntries.length" :title="t('devices.aclEmpty')" />
          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('common.mac') }}</th>
                  <th>{{ t('common.action') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in aclEntries" :key="row.mac">
                  <td class="mac">{{ row.mac }}</td>
                  <td>
                    <button
                      type="button"
                      class="icon-action unlock"
                      :disabled="aclBusyMac === row.mac"
                      :title="t('devices.removeFromAcl')"
                      @click="removeFromAcl(row.mac)"
                    >
                      <UiIcon name="lock" :size="18" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </UiCard>
    </template>
  </div>
</template>

<style scoped>
.factory-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.factory-tab {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 8px 18px;
  font-size: 14px;
  color: var(--color-muted);
  background: var(--color-surface);
  cursor: pointer;
}

.factory-tab.active {
  color: #fff;
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.mac {
  font-size: 12px;
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
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-action.unlock {
  color: var(--color-danger);
}
</style>
