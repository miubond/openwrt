<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiIcon from '@/components/UiIcon.vue'
import UiSelect from '@/components/UiSelect.vue'
import UiButton from '@/components/UiButton.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { toDeviceView, type DeviceView } from '@/api/view-map'
import { useToastStore } from '@/stores/toast'
import type { DeviceAclEntry } from '@/api/types'

const POLL_MS = 6000

type DeviceRow = DeviceView

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const devices = ref<DeviceRow[]>([])
const aclEntries = ref<DeviceAclEntry[]>([])
const factoryTab = ref<'online' | 'acl'>('online')
const aclBusyMac = ref<string | null>(null)
const keyword = ref('')
const linkFilter = ref('all')
const statusFilter = ref('all')
const selectedId = ref<string | null>(null)
const selected = computed(() => devices.value.find(d => d.id === selectedId.value))
const onlineCount = computed(() => devices.value.filter(d => d.online).length)
const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  return devices.value.filter(d =>
    (linkFilter.value === 'all' || d.link === linkFilter.value) &&
    (statusFilter.value === 'all' || d.online === (statusFilter.value === 'online')) &&
    (!query || [d.name, d.ip, d.mac].some(value => value?.toLowerCase().includes(query))),
  )
})
const linkOptions = computed(() => ['all', 'ethernet', 'wifi', 'unknown'].map(value => ({ value, label: t(`devices.link.${value}`) })))
const statusOptions = computed(() => ['all', 'online', 'offline'].map(value => ({ value, label: t(`devices.status.${value}`) })))
function closeDetail(e: KeyboardEvent) {
  if (e.key === 'Escape') selectedId.value = null
}

let pollTimer: ReturnType<typeof setInterval> | undefined

const aclMacSet = computed(() => new Set(aclEntries.value.map((e) => e.mac.toLowerCase())))

async function loadDevices() {
  const list = unwrap(await getRouterApi().getConnectedDevices())
  devices.value = list.map((d) => toDeviceView(d))
}

async function loadAcl() {
  aclEntries.value = unwrap(await getRouterApi().getDeviceAclList())
}

async function load() {
  loading.value = true
  try {
    await Promise.all([loadDevices(), loadAcl()])
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function refreshQuiet() {
  try {
    await Promise.all([loadDevices(), loadAcl()])
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
  document.addEventListener('keydown', closeDetail)
  pollTimer = setInterval(() => void refreshQuiet(), POLL_MS)
})

onUnmounted(() => {
  document.removeEventListener('keydown', closeDetail)
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="devices-page">
    <LoadingState v-if="loading" />
    <template v-else>
      <div class="device-summary">
        <span>{{ t('devices.onlineList') }}</span><strong>{{ onlineCount }}</strong>
      </div>
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
          <div class="device-filters">
            <input v-model="keyword" type="search" :placeholder="t('devices.search')" :aria-label="t('devices.search')" />
            <UiSelect v-model="linkFilter" :options="linkOptions" :aria-label="t('devices.linkLabel')" />
            <UiSelect v-model="statusFilter" :options="statusOptions" :aria-label="t('devices.statusLabel')" />
            <UiButton variant="secondary" @click="load">{{ t('common.refresh') }}</UiButton>
          </div>
          <EmptyState v-if="!filtered.length" :title="keyword || linkFilter !== 'all' || statusFilter !== 'all' ? t('devices.noMatch') : t('common.emptyOnline')" />
          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('common.ip') }}</th>
                  <th>{{ t('common.mac') }}</th>
                  <th>{{ t('common.hostname') }}</th>
                  <th>{{ t('devices.linkLabel') }}</th>
                  <th>{{ t('devices.statusLabel') }}</th>
                  <th>{{ t('common.action') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in filtered" :key="d.id">
                  <td>{{ d.ip || '—' }}</td>
                  <td class="mac">{{ d.mac }}</td>
                  <td>{{ d.name || '—' }}</td>
                  <td>{{ t(`devices.link.${d.link}`) }}</td>
                  <td><span class="pill" :class="d.online ? 'ok' : 'off'">{{ t(d.online ? 'devices.status.online' : 'devices.status.offline') }}</span></td>
                  <td>
                    <button type="button" class="detail-action" @click="selectedId = d.id">{{ t('devices.details') }}</button>
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
    <Teleport to="body">
      <div v-if="selectedId" class="device-drawer">
        <div class="device-drawer-mask" @click="selectedId = null" />
        <aside class="device-drawer-panel" role="dialog" aria-modal="true" :aria-label="t('devices.details')">
          <header class="device-drawer-head">
            <h3>{{ t('devices.details') }}</h3>
            <button type="button" :aria-label="t('common.cancel')" @click="selectedId = null">×</button>
          </header>
          <div v-if="selected" class="device-detail">
            <div class="device-detail-title"><UiIcon name="pc" :size="26" /><strong>{{ selected.name }}</strong></div>
            <dl>
              <div><dt>{{ t('common.ip') }}</dt><dd>{{ selected.ip || '—' }}</dd></div>
              <div><dt>{{ t('common.mac') }}</dt><dd class="mac">{{ selected.mac }}</dd></div>
              <div><dt>{{ t('devices.linkLabel') }}</dt><dd>{{ t(`devices.link.${selected.link}`) }}</dd></div>
              <div><dt>{{ t('devices.interface') }}</dt><dd>{{ selected.iface || '—' }}</dd></div>
              <div><dt>{{ t('devices.statusLabel') }}</dt><dd>{{ t(selected.online ? 'devices.status.online' : 'devices.status.offline') }}</dd></div>
            </dl>
            <UiButton v-if="isInAcl(selected.mac)" variant="secondary" :disabled="aclBusyMac === selected.mac" @click="removeFromAcl(selected.mac)">{{ t('devices.removeFromAcl') }}</UiButton>
            <UiButton v-else variant="danger" :disabled="aclBusyMac === selected.mac" @click="addToAcl(selected.mac)">{{ t('devices.addToAcl') }}</UiButton>
          </div>
          <EmptyState v-else :title="t('devices.noMatch')" />
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.device-summary { display: inline-flex; align-items: baseline; gap: 12px; padding: 12px 16px; margin-bottom: 16px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); }
.device-summary span { color: var(--color-muted); font-size: var(--fs-xs); }
.device-summary strong { font-size: 20px; color: var(--color-title); }
.device-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.device-filters input { min-width: 180px; flex: 1; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); }
.device-filters input:focus { outline: 2px solid var(--color-primary-soft); border-color: var(--color-primary); }
.detail-action { border: 0; background: transparent; color: var(--color-primary); cursor: pointer; }
.device-drawer { position: fixed; inset: 0; z-index: var(--z-modal, 300); }
.device-drawer-mask { position: absolute; inset: 0; background: rgba(15, 23, 42, .35); }
.device-drawer-panel { position: absolute; right: 0; top: 0; bottom: 0; width: min(420px, 100%); background: var(--color-surface); color: var(--color-text); box-shadow: -8px 0 24px rgba(15, 23, 42, .12); overflow-y: auto; }
.device-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--color-border); }
.device-drawer-head h3 { margin: 0; font-size: var(--fs-md); }
.device-drawer-head button { border: 0; background: transparent; color: var(--color-muted); cursor: pointer; font-size: 22px; }
.device-detail { padding: 16px; }
.device-detail-title { display: flex; gap: 12px; align-items: center; color: var(--color-primary); overflow-wrap: anywhere; }
.device-detail dl { padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); margin: 16px 0; }
.device-detail dl > div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; margin: 8px 0; }
.device-detail dt { color: var(--color-muted); }
.device-detail dd { margin: 0; overflow-wrap: anywhere; }

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
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
