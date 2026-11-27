<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiIcon from '@/components/UiIcon.vue'
import type { PhysicalPortStatus, SystemStatus } from '@/api/types'
import { formatApiError, getRouterApi, isMissingNativeRouteError, isUnauthorizedError, unwrap } from '@/api'
import { DeviceRouterAdapter } from '@/api/adapters/device-adapter'
import { useAuthStore } from '@/stores/auth'
import {
  toDeviceView,
  toSystemStatusView,
  toWanStatusView,
  toWifiStatusView,
  type DeviceView,
  type SystemStatusView,
  type WanStatusView,
  type WifiStatusView,
} from '@/api/view-map'
import { formatDateTime, formatLiveRate, formatUptime } from '@/utils/format'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const toast = useToastStore()
const bootFailed = ref(false)
const devicesLoading = ref(false)
const system = ref<SystemStatusView | null>(null)
const wan = ref<WanStatusView | null>(null)
const wifi = ref<WifiStatusView | null>(null)
const physicalPorts = ref<PhysicalPortStatus[]>([])
const devices = ref<DeviceView[]>([])
let timer: number | undefined
let loadSeq = 0

/** 至少一块关键数据到位；骨架阶段也直接展示布局 */
const ready = computed(() => Boolean(system.value && wan.value && wifi.value))
const showShell = computed(() => !bootFailed.value || ready.value)

/** 逻辑 WAN（HYID 25）：与拓扑「Internet」一致 */
const wanLinkUp = computed(() => Boolean(wan.value?.up))
/** 物理 WAN 口（HYID 108 port_arr）；未核验映射时不猜 WAN */
const physicalWanUp = computed(
  () =>
    physicalPorts.value.find((p) => p.role === 'wan' && p.mappingVerified !== false)?.linkUp ??
    wanLinkUp.value,
)
const physicalMappingVerified = computed(
  () =>
    physicalPorts.value.length > 0 &&
    physicalPorts.value.every((p) => p.mappingVerified !== false),
)
const staListCount = computed(() => devices.value.length)

function wanRateText(bps: number) {
  return formatLiveRate(bps, wan.value?.ratesReady, t('dashboard.rateMeasuring'))
}
const unverifiedPhysicalPorts = computed(() =>
  physicalPorts.value.some((p) => p.mappingVerified === false || p.role === 'unknown'),
)
const portPlaceholders = [
  { id: 'lan1', label: 'LAN1', role: 'lan' as const },
  { id: 'lan2', label: 'LAN2', role: 'lan' as const },
  { id: 'lan3', label: 'LAN3', role: 'lan' as const },
  { id: 'lan4', label: 'LAN4', role: 'lan' as const },
  { id: 'wan', label: 'WAN', role: 'wan' as const },
]
/** 使用后端标签与角色；数组顺序不能推断机箱映射 */
const displayedPorts = computed<PhysicalPortStatus[]>(() =>
  physicalPorts.value.length
    ? physicalPorts.value
    : portPlaceholders.map((p) => ({ ...p, linkUp: false, speedMbps: 0 })),
)

/** 首页预览最多 5 条，按实际数据行数渲染，不补空行 */
const terminalPreview = computed(() => devices.value.slice(0, 5))

function portStatusLabel(port: PhysicalPortStatus) {
  if (port.linkKnown === false || port.linkUp === null) return t('dashboard.linkUnknown')
  if (!port.linkUp) return t('dashboard.portDown')
  const speed = port.speedMbps > 0 ? `${port.speedMbps}M` : ''
  return t('dashboard.portConnected', { speed: speed ? `${speed} ` : '' })
}

function wanAccessLabel(proto: string) {
  const raw = proto.trim()
  if (!raw) return '—'
  const key = raw.toLowerCase()
  const path = `dashboard.netType.${key}`
  const mapped = t(path)
  return mapped === path ? raw : mapped
}

async function handleLoadError(e: unknown) {
  if (isUnauthorizedError(e)) {
    auth.setSession(null)
    await router.replace({ name: 'login', query: { redirect: route.fullPath } })
    return true
  }
  toast.error(formatApiError(e, t))
  return false
}

async function load(quiet = false) {
  const seq = ++loadSeq
  if (!quiet) bootFailed.value = false
  if (!quiet || !devices.value.length) devicesLoading.value = true

  const api = getRouterApi()

  if (api instanceof DeviceRouterAdapter) {
    try {
      const data = unwrap(await api.getHomeDashboard())
      if (seq !== loadSeq) return
      const st: SystemStatus = {
        cpuPercent: null,
        memoryPercent: 0,
        uptimeSec: data.system.uptimeSec,
        interfaces: [],
        wirelessClients: data.wifi.clients,
        wiredClients: 0,
      }
      system.value = toSystemStatusView(data.system, st)
      wan.value = toWanStatusView(data.wan)
      wifi.value = toWifiStatusView(data.wifi)
      physicalPorts.value = data.physicalPorts
      devices.value = data.devices.map(toDeviceView)
      if (!quiet) bootFailed.value = false
      if (seq === loadSeq) devicesLoading.value = false
      return
    } catch (e) {
      if (isUnauthorizedError(e)) {
        await handleLoadError(e)
        return
      }
      if (!isMissingNativeRouteError(e)) {
        if (seq === loadSeq) devicesLoading.value = false
        if (!quiet) {
          bootFailed.value = true
          toast.error(formatApiError(e, t))
        }
        return
      }
      /* 仅旧固件无 home/dashboard 时回退多请求 */
    }
  }

  /** 各接口独立落地：谁先返回谁先填卡片，不再整页等齐 */
  const infoTask = api.getSystemInfo().then((res) => {
    if (seq !== loadSeq) return
    const info = unwrap(res)
    const st: SystemStatus = {
      cpuPercent: import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? null : 0,
      memoryPercent: 0,
      uptimeSec: info.uptimeSec,
      interfaces: [],
      wirelessClients: 0,
      wiredClients: 0,
    }
    system.value = toSystemStatusView(info, st)
  })

  const wanTask = api.getWanStatus().then((res) => {
    if (seq !== loadSeq) return
    wan.value = toWanStatusView(unwrap(res))
  })

  const wifiTask = api.getWifiStatus().then((res) => {
    if (seq !== loadSeq) return
    wifi.value = toWifiStatusView(unwrap(res))
  })

  const portsTask = api.getPhysicalPorts().then((res) => {
    if (seq !== loadSeq) return
    physicalPorts.value = unwrap(res)
  })

  const devicesTask = api
    .getConnectedDevices()
    .then((res) => {
      if (seq !== loadSeq) return
      devices.value = unwrap(res).map(toDeviceView)
    })
    .finally(() => {
      if (seq === loadSeq) devicesLoading.value = false
    })

  const results = await Promise.allSettled([infoTask, wanTask, wifiTask, portsTask, devicesTask])
  if (seq !== loadSeq) return

  for (const result of results) {
    if (result.status !== 'rejected') continue
    const redirected = await handleLoadError(result.reason)
    if (redirected) return
  }

  if (!ready.value) bootFailed.value = true
}

const diagnosing = ref(false)

async function diagnose() {
  if (diagnosing.value || !wan.value) return
  diagnosing.value = true
  try {
    const r = unwrap(
      await getRouterApi().runDiagnostic({ type: 'ping', target: '223.5.5.5', count: 3 }),
    )
    toast.info(r.success ? t('diagnose.ok') : t('diagnose.fail'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    diagnosing.value = false
  }
}

const POLL_MS_VISIBLE =
  import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? 20_000 : 10_000
const POLL_MS_HIDDEN = 30_000

let pollStarted = false

function schedulePoll() {
  if (pollStarted) return
  pollStarted = true
  if (timer) window.clearInterval(timer)
  const ms = document.visibilityState === 'hidden' ? POLL_MS_HIDDEN : POLL_MS_VISIBLE
  timer = window.setInterval(() => void load(true), ms)
}

function onVisibilityChange() {
  if (!pollStarted) return
  if (timer) window.clearInterval(timer)
  const ms = document.visibilityState === 'hidden' ? POLL_MS_HIDDEN : POLL_MS_VISIBLE
  timer = window.setInterval(() => void load(true), ms)
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  void (async () => {
    await load()
    schedulePoll()
  })()
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <div class="dashboard">
    <UiCard v-if="bootFailed && !ready" :title="t('common.loadFailed')">
      <p class="load-err">{{ t('common.loadFailed') }}</p>
      <UiButton variant="secondary" @click="load()">{{ t('common.retry') }}</UiButton>
    </UiCard>

    <template v-else-if="showShell">
      <UiCard class="mb topo-card" icon="network" :title="t('dashboard.topology')">
        <template #extra>
          <span v-if="ready" class="pill ok topo-status">{{ t('dashboard.runningOk') }}</span>
          <span v-else class="skel skel-pill" aria-hidden="true" />
        </template>
        <template #actions>
          <UiButton
            class="diagnose-btn"
            variant="secondary"
            :disabled="!wan || diagnosing"
            @click="diagnose"
          >
            {{ diagnosing ? t('diagnose.running') : t('dashboard.diagnose') }}
          </UiButton>
        </template>

        <div class="topo">
          <div class="node">
            <div class="node-ico globe"><UiIcon name="globe" :size="26" /></div>
            <strong>{{ t('dashboard.internet') }}</strong>
            <span v-if="wan" class="pill" :class="wanLinkUp ? 'ok' : 'off'">{{
              wanLinkUp ? t('common.connected') : t('common.disconnected')
            }}</span>
            <span v-else class="skel skel-pill" aria-hidden="true" />
          </div>

          <div class="link">
            <div class="line" />
            <div v-if="wan" class="rates rates-traffic">
              <span class="rate-up">↑ {{ wanRateText(wan.txRateBps) }}</span>
              <span class="rate-down">↓ {{ wanRateText(wan.rxRateBps) }}</span>
            </div>
            <div v-else class="rates">
              <span class="skel skel-line" aria-hidden="true" />
              <span class="skel skel-line" aria-hidden="true" />
            </div>
          </div>

          <div class="node main">
            <div class="node-ico router"><UiIcon name="router" :size="28" /></div>
            <strong>{{ t('dashboard.router') }}</strong>
            <span class="pill ok">{{ t('dashboard.routerOk') }}</span>
            <small v-if="wifi">{{ t('dashboard.wifiBand', { ssid: wifi.ssid || 'Wi-Fi' }) }}</small>
            <span v-else class="skel skel-line skel-ssid" aria-hidden="true" />
          </div>

          <div class="link">
            <div class="line" />
            <div class="rates">
              <span v-if="!devicesLoading || devices.length">{{ t('dashboard.staListCount', { n: staListCount }) }}</span>
              <span v-else class="skel skel-line" aria-hidden="true" />
            </div>
          </div>

          <div class="node">
            <div class="node-ico pc"><UiIcon name="pc" :size="26" /></div>
            <strong>{{ t('dashboard.terminals') }}</strong>
            <span v-if="!devicesLoading || devices.length" class="pill ok">{{
              t('dashboard.staListHint', { n: staListCount })
            }}</span>
            <span v-else class="skel skel-pill" aria-hidden="true" />
          </div>
        </div>
      </UiCard>

      <div class="grid-3 mb dash-grid">
        <UiCard class="dash-card" icon="globe" :title="t('dashboard.wanInfo')">
          <div class="panel panel-wan">
            <dl v-if="wan" class="kv info-kv">
              <div>
                <dt>{{ t('dashboard.wanLogic') }}</dt>
                <dd>
                  <span class="pill" :class="wanLinkUp ? 'ok' : 'off'">{{
                    wanLinkUp ? t('common.connected') : t('common.disconnected')
                  }}</span>
                </dd>
              </div>
              <template v-if="wanLinkUp">
                <div><dt>{{ t('dashboard.ip') }}</dt><dd>{{ wan.ipv4 || '—' }}</dd></div>
                <div><dt>{{ t('dashboard.netmask') }}</dt><dd>{{ wan.netmask || '—' }}</dd></div>
                <div>
                  <dt>{{ t('dashboard.uplink') }}</dt>
                  <dd class="rate-up">{{ wanRateText(wan.txRateBps) }}</dd>
                </div>
                <div>
                  <dt>{{ t('dashboard.downlink') }}</dt>
                  <dd class="rate-down">{{ wanRateText(wan.rxRateBps) }}</dd>
                </div>
                <div><dt>{{ t('dashboard.access') }}</dt><dd>{{ wanAccessLabel(wan.proto) }}</dd></div>
              </template>
              <template v-else>
                <div><dt>{{ t('dashboard.connStatus') }}</dt><dd>{{ t('common.disconnected') }}</dd></div>
                <div class="kv-spacer" aria-hidden="true" />
                <div class="kv-spacer" aria-hidden="true" />
                <div class="kv-spacer" aria-hidden="true" />
                <div class="kv-spacer" aria-hidden="true" />
              </template>
            </dl>
            <div v-else class="skel-stack" aria-busy="true" aria-label="loading">
              <span v-for="n in 6" :key="n" class="skel skel-row" />
            </div>
          </div>
        </UiCard>

        <UiCard class="dash-card" icon="wifi" :title="t('dashboard.wifiInfo')">
          <div class="panel panel-wifi">
            <dl v-if="wifi" class="kv info-kv">
              <div>
                <dt>{{ t('dashboard.wifiStatus') }}</dt>
                <dd>
                  <span class="pill" :class="wifi.up ? 'ok' : 'off'">{{
                    wifi.up ? t('common.enabled') : t('common.disabled')
                  }}</span>
                </dd>
              </div>
              <div><dt>{{ t('dashboard.ssid') }}</dt><dd>{{ wifi.ssid || '—' }}</dd></div>
              <div><dt>{{ t('dashboard.mode') }}</dt><dd>{{ wifi.mode || '—' }}</dd></div>
              <div><dt>{{ t('dashboard.channel') }}</dt><dd>{{ wifi.channelLabel || '—' }}</dd></div>
              <div><dt>{{ t('dashboard.authMode') }}</dt><dd>{{ wifi.security || '—' }}</dd></div>
              <div><dt>{{ t('dashboard.mac') }}</dt><dd class="mono">{{ wifi.mac || '—' }}</dd></div>
              <div>
                <dt>{{ t('dashboard.associated') }}</dt>
                <dd>
                  <button class="link-btn clients-link" type="button" @click="router.push({ name: 'devices' })">
                    {{ t('dashboard.clientsView', { n: wifi.clients ?? 0 }) }}
                  </button>
                </dd>
              </div>
            </dl>
            <div v-else class="skel-stack" aria-busy="true" aria-label="loading">
              <span v-for="n in 7" :key="n" class="skel skel-row" />
            </div>
          </div>
        </UiCard>

        <UiCard class="dash-card" icon="port" :title="t('dashboard.ports', { n: physicalPorts.length || displayedPorts.length })">
          <div class="panel panel-ports">
            <div class="ports" :class="{ 'ports-pending': !physicalPorts.length }">
              <div
                v-for="p in displayedPorts"
                :key="p.id"
                class="port"
                :class="[p.mappingVerified === false ? 'unknown' : p.role, { up: physicalPorts.length ? p.linkUp : false }]"
              >
                <div class="port-ico"><UiIcon name="port" :size="18" /></div>
                <strong>{{ p.label }}</strong>
                <span v-if="physicalPorts.length" class="port-status" :title="portStatusLabel(p)">{{ portStatusLabel(p) }}</span>
                <span v-else class="skel skel-line skel-port" aria-hidden="true" />
              </div>
            </div>
            <div class="legend">
              <span v-if="!unverifiedPhysicalPorts"><i class="lan" /> {{ t('dashboard.legendLan') }}</span>
              <span v-if="!unverifiedPhysicalPorts"><i class="wan" /> {{ t('dashboard.legendWan') }}</span>
              <span v-else>{{ t('dashboard.physicalMappingUnverified') }}</span>
              <span><i class="down" /> {{ t('dashboard.legendDown') }}</span>
            </div>
            <div class="ports-warn-slot">
              <p v-if="physicalMappingVerified && physicalWanUp !== wanLinkUp" class="ports-warn">
                {{ t('dashboard.wanStateMismatch') }}
              </p>
            </div>
          </div>
        </UiCard>
      </div>

      <div class="grid-2 dash-grid">
        <UiCard class="dash-card" icon="info" :title="t('dashboard.systemInfo')">
          <div class="panel panel-system">
            <dl v-if="system" class="kv info-kv">
              <div><dt>{{ t('dashboard.productName') }}</dt><dd>{{ system.model || '—' }}</dd></div>
              <div><dt>{{ t('dashboard.softwareVersion') }}</dt><dd>{{ system.firmwareVersion || '—' }}</dd></div>
              <div>
                <dt>{{ t('dashboard.domain') }}</dt>
                <dd>
                  <a
                    v-if="system.domain"
                    class="link-btn"
                    :href="`http://${system.domain}`"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ system.domain }}
                  </a>
                  <template v-else>—</template>
                </dd>
              </div>
              <div><dt>{{ t('dashboard.sysTime') }}</dt><dd>{{ formatDateTime(system.time.local) }}</dd></div>
              <div><dt>{{ t('dashboard.sysUptime') }}</dt><dd>{{ formatUptime(system.uptimeSec, t) }}</dd></div>
              <div><dt>{{ t('dashboard.deviceNumber') }}</dt><dd>{{ system.deviceNumber || '—' }}</dd></div>
            </dl>
            <div v-else class="skel-stack" aria-busy="true" aria-label="loading">
              <span v-for="n in 6" :key="n" class="skel skel-row" />
            </div>
          </div>
        </UiCard>

        <UiCard class="dash-card terminals-card" icon="devices" :title="t('dashboard.onlineTerminals')">
          <template #actions>
            <button
              type="button"
              class="link-btn view-all-link"
              @click="router.push({ name: 'devices' })"
            >
              {{ t('dashboard.viewAll') }}
            </button>
          </template>
          <div class="panel panel-terminals">
            <p class="terminals-caption">
              <template v-if="!devicesLoading || devices.length">
                {{ t('dashboard.staListHint', { n: staListCount }) }}
              </template>
              <span v-else class="skel skel-line skel-caption" aria-hidden="true" />
            </p>
            <div class="table-wrap table-scroll">
              <table class="table terminals-table">
                <thead>
                  <tr>
                    <th class="col-idx">#</th>
                    <th class="col-name">{{ t('dashboard.colDevice') }}</th>
                    <th class="col-mac">{{ t('dashboard.colMac') }}</th>
                    <th class="col-ip">{{ t('dashboard.colIp') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="devicesLoading && !terminalPreview.length">
                    <td class="col-idx">1</td>
                    <td class="col-name"><span class="skel skel-cell" aria-hidden="true" /></td>
                    <td class="col-mac"><span class="skel skel-cell" aria-hidden="true" /></td>
                    <td class="col-ip"><span class="skel skel-cell" aria-hidden="true" /></td>
                  </tr>
                  <tr v-else-if="!terminalPreview.length">
                    <td class="empty-cell" colspan="4">{{ t('dashboard.noOnline') }}</td>
                  </tr>
                  <tr v-for="(d, i) in terminalPreview" :key="d.id">
                    <td class="col-idx">{{ i + 1 }}</td>
                    <td class="col-name" :title="d.name || undefined">{{ d.name || '—' }}</td>
                    <td class="col-mac" :title="d.mac || undefined">{{ d.mac || '—' }}</td>
                    <td class="col-ip" :title="d.ip || undefined">{{ d.ip || '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </UiCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 1rem;
}
.ports-note {
  margin: 0 0 0.65rem;
  font-size: var(--fs-xs);
  color: var(--color-muted);
}
.terminals-card :deep(.head) {
  align-items: center;
  padding-bottom: 4px;
}
.terminals-card :deep(.title-row) {
  align-items: center;
}
.terminals-card :deep(.actions) {
  align-items: center;
}
.view-all-link {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  white-space: nowrap;
}
.dash-grid :deep(.card.dash-card) {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.dash-grid :deep(.dash-card .body) {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.panel {
  width: 100%;
}
.panel-wan {
  min-height: 13rem;
}
.panel-wifi {
  min-height: 15.25rem;
}
.panel-system {
  min-height: 13rem;
}
.panel-ports {
  min-height: 13rem;
}
.panel-terminals {
  min-height: 13rem;
}
.kv-spacer {
  min-height: 1.75rem;
  visibility: hidden;
}
.skel {
  display: inline-block;
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    var(--color-skel) 0%,
    var(--color-skel-highlight) 50%,
    var(--color-skel) 100%
  );
  background-size: 200% 100%;
  animation: skel-shine 1.1s ease-in-out infinite;
}
.skel-pill {
  width: 4.5rem;
  height: 1.35rem;
  border-radius: 999px;
  vertical-align: middle;
}
.skel-line {
  width: 4.75rem;
  height: 0.75rem;
}
.skel-ssid {
  display: block;
  width: 7rem;
  min-height: 1.1rem;
  margin-top: 2px;
}
.skel-port {
  width: 3.5rem;
  height: 0.7rem;
}
.skel-caption {
  width: 9rem;
  height: 0.85rem;
  vertical-align: middle;
}
.skel-cell {
  width: 100%;
  max-width: 7rem;
  height: 0.75rem;
  vertical-align: middle;
}
.skel-stack {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  min-height: inherit;
  align-content: start;
}
.skel-row {
  width: 100%;
  height: 1.75rem;
}
.skel-row:nth-child(2n) {
  width: 86%;
}
.ports-pending .port {
  opacity: 0.72;
}
.ports-warn-slot {
  min-height: 1.35rem;
  margin-top: 0.35rem;
}
.ports-warn {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--color-warning, #d48806);
}
.muted-cell {
  color: var(--color-muted);
  font-size: var(--fs-xs);
}
.terminals-table .empty-cell {
  text-align: center;
  color: var(--color-muted);
  font-size: var(--fs-sm);
  padding: 1.25rem 0.75rem;
}
@keyframes skel-shine {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
.terminals-caption {
  margin: 0 0 6px;
  padding: 0 10px;
  min-height: 1.1rem;
  font-size: var(--fs-xs);
  color: var(--color-muted);
  line-height: var(--lh-tight);
}
.terminals-table {
  table-layout: fixed;
  width: 100%;
}
.terminals-table tbody tr {
  height: 2.15rem;
}
.terminals-table .col-idx {
  width: 3rem;
  text-align: center;
  color: var(--color-muted);
}
.terminals-table .col-name {
  width: 30%;
  max-width: 6.25rem;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminals-table .col-mac {
  width: 35%;
  min-width: 0;
  text-align: left;
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.terminals-table .col-ip {
  width: 35%;
  min-width: 0;
  text-align: right;
  font-size: var(--fs-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.terminals-table th.col-idx,
.terminals-table td.col-idx {
  padding-left: 10px;
  padding-right: 6px;
}
.terminals-table th.col-mac,
.terminals-table td.col-mac {
  padding-left: 6px;
  padding-right: 6px;
}
.terminals-table th.col-name,
.terminals-table td.col-name {
  padding-right: 4px;
}
.terminals-table th.col-ip,
.terminals-table td.col-ip {
  padding-right: 10px;
  padding-left: 4px;
}
.topo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.25rem 0.25rem;
  overflow-x: auto;
}
.node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  min-width: 120px;
  text-align: center;
}
.node strong {
  color: var(--color-title);
  font-size: var(--fs-base);
}
.node small {
  min-height: 1.1rem;
  color: var(--color-muted);
  font-size: var(--fs-xs);
}
.node-ico {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  color: #fff;
}
.node-ico.globe {
  background: linear-gradient(145deg, #3b82f6, #1677ff);
}
.node-ico.router {
  background: linear-gradient(145deg, #0b1f44, #1677ff);
}
.node-ico.pc {
  background: linear-gradient(145deg, #14b8a6, #0d9488);
}
.link {
  flex: 1;
  min-width: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
}
.line {
  width: 100%;
  height: 2px;
  background: linear-gradient(90deg, #bfdbfe, #1677ff, #bfdbfe);
  border-radius: 2px;
}
.rates {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.1rem;
  min-height: 2.35rem;
  font-size: var(--fs-xs);
  color: var(--color-muted);
  white-space: nowrap;
}
.rates-traffic {
  font-weight: var(--fw-semibold);
  letter-spacing: 0.01em;
}
.rate-up {
  color: var(--color-success);
}
.rate-down {
  color: var(--color-danger);
}
/* 提高优先级，避免被 .info-kv dd 的标题色盖掉 */
.info-kv dd.rate-up {
  color: var(--color-success);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
}
.info-kv dd.rate-down {
  color: var(--color-danger);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
}
.kv {
  margin: 0;
  display: grid;
  gap: 0.65rem;
}
.kv div {
  display: grid;
  grid-template-columns: minmax(6.5rem, 38%) minmax(0, 1fr);
  gap: 0.5rem 0.75rem;
  align-items: baseline;
  font-size: var(--fs-base);
}
.info-kv {
  gap: 0.5rem;
}
.info-kv div {
  grid-template-columns: minmax(5.5rem, 42%) minmax(0, 1fr);
  gap: 0.35rem 0.75rem;
  align-items: start;
  min-height: 1.75rem;
}
.info-kv dt {
  color: var(--color-muted);
  font-size: var(--fs-sm);
  line-height: 1.35;
  white-space: normal;
  overflow-wrap: break-word;
  hyphens: auto;
}
.info-kv dd {
  margin: 0;
  color: var(--color-title);
  font-size: var(--fs-sm);
  line-height: 1.45;
  word-break: break-word;
  text-align: left;
  min-width: 0;
}
.info-kv dd.mono {
  font-size: 13px;
  letter-spacing: 0.01em;
}
.info-kv .clients-link {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.kv dt {
  color: var(--color-muted);
}
.kv dd {
  margin: 0;
  color: var(--color-title);
  word-break: break-word;
}
.ports {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.55rem;
}
.port {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.55rem 0.3rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: center;
  color: var(--color-muted);
  background: var(--color-table-head);
  min-width: 0;
  overflow: hidden;
}
.port strong {
  font-size: var(--fs-xs);
  color: var(--color-title);
}
.port span {
  font-size: var(--fs-xs);
  line-height: 1.25;
  width: 100%;
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.port-ico {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--color-bg-muted);
  color: var(--color-muted);
}
.port.up.lan .port-ico {
  background: var(--color-success-soft);
  color: var(--color-lan);
}
.port.up.wan .port-ico {
  background: var(--color-primary-soft);
  color: var(--color-wan);
}
.port.up {
  border-color: var(--color-primary);
  background: var(--color-surface);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin-top: 0.85rem;
  color: var(--color-muted);
  font-size: var(--fs-xs);
}
.legend i {
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  margin-right: 0.25rem;
}
.legend .lan {
  background: var(--color-lan);
}
.legend .wan {
  background: var(--color-wan);
}
.legend .down {
  background: #c9cdd4;
}
.empty {
  color: var(--color-muted);
  margin: 0;
}
@media (max-width: 900px) {
  .ports {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .dashboard {
    margin: 0 -2px;
  }

  .mb {
    margin-bottom: 12px;
  }

  .topo-card :deep(.title-row) {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .topo-status {
    max-width: 100%;
    white-space: normal;
    text-align: left;
    line-height: 1.35;
  }

  .topo-card :deep(.diagnose-btn) {
    width: 100%;
  }

  .topo {
    flex-direction: column;
    align-items: stretch;
    overflow-x: visible;
    padding: 4px 0 0;
    gap: 0;
  }

  .node {
    min-width: 0;
    width: 100%;
    max-width: 280px;
    padding: 8px 0;
    align-self: center;
  }

  .node-ico {
    width: 52px;
    height: 52px;
  }

  .link {
    width: auto;
    min-width: 0;
    height: auto;
    padding: 2px 0 6px;
  }

  .line {
    width: 2px;
    height: 28px;
    background: linear-gradient(180deg, #bfdbfe, #1677ff, #bfdbfe);
  }

  .rates {
    font-size: 11px;
    text-align: center;
  }

  .kv div,
  .info-kv div {
    grid-template-columns: minmax(5.5rem, 40%) minmax(0, 1fr);
    gap: 8px 10px;
    font-size: var(--fs-sm);
  }

  .ports {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .legend {
    gap: 10px 14px;
  }

  .table-scroll {
    margin: 0 -4px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .table-scroll .table {
    min-width: 280px;
  }
}

@media (max-width: 380px) {
  .ports {
    grid-template-columns: 1fr;
  }
}
</style>
