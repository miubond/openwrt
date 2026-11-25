<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import UiIcon from '@/components/UiIcon.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap, WG_SECRET_MASK } from '@/api'
import type { WireGuardClientConfig, WireGuardStatus } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import {
  copyText,
  failureReason,
  handshakeText,
  joinList,
  probeText,
  routeConflicts,
  runtimeBadge,
  runtimeKind,
  splitList,
  trafficRx,
  trafficTx,
} from './wireguard'

type SecretAction = 'keep' | 'set' | 'generate' | 'clear'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const report = ref<WireGuardStatus | null>(null)
const importOpen = ref(false)
const importText = ref('')
const importing = ref(false)
const generateOpen = ref(false)
const globalOpen = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const form = reactive<WireGuardClientConfig>({
  enabled: false,
  privateKey: '',
  publicKey: '',
  addresses: [],
  dns: [],
  useDns: false,
  mtu: 1420,
  routeMode: 'split',
  allowGlobalRoute: false,
  peer: { publicKey: '', presharedKey: '', endpointHost: '', endpointPort: 51820, allowedIPs: [], keepalive: 25 },
})
const text = reactive({ addresses: '', dns: '', allowedIPs: '' })
/** 私钥/PSK 只存在于这几个输入框，保存后立即清空 */
const secrets = reactive({ privateKey: '', privateAction: 'keep' as SecretAction, psk: '', pskAction: 'keep' as SecretAction })
const hasPsk = ref(false)
const reservedNets = ref<WireGuardClientConfig['reservedNets']>([])

let loadedEnabled = false
let loadedGlobal = false
let timer: ReturnType<typeof setInterval> | undefined
let snapshot: {
  form: WireGuardClientConfig
  text: { addresses: string; dns: string; allowedIPs: string }
  hasPsk: boolean
} | null = null

const client = computed(() => report.value?.client ?? null)
const kind = computed(() => runtimeKind(report.value, client.value))
const statusBadge = computed(() => {
  const badge = runtimeBadge(kind.value)
  return { status: badge.status, label: t(badge.labelKey) }
})
const applied = computed(() => !!client.value?.enabled)
const serviceOk = computed(() => form.serviceAvailable !== false)
const busy = computed(() => saving.value || !!pending.value)
const conflicts = computed(() =>
  form.routeMode === 'split' ? routeConflicts(splitList(text.allowedIPs), reservedNets.value) : [],
)
const failText = computed(() => failureReason(client.value, kind.value, t))

function stopPoll() {
  if (timer) clearInterval(timer)
  timer = undefined
}

async function refreshStatus() {
  try {
    report.value = unwrap(await getRouterApi().getWireGuardStatus())
  } catch {
    stopPoll()
  }
}

function startPoll() {
  stopPoll()
  if (!loadedEnabled) return
  void refreshStatus()
  timer = setInterval(() => void refreshStatus(), 10_000)
}

function resetSecrets() {
  secrets.privateKey = ''
  secrets.privateAction = 'keep'
  secrets.psk = ''
  secrets.pskAction = 'keep'
}

function takeSnapshot(data: WireGuardClientConfig) {
  snapshot = {
    form: structuredClone({ ...data, peer: { ...data.peer } }),
    text: {
      addresses: joinList(data.addresses),
      dns: joinList(data.dns),
      allowedIPs: joinList(data.peer.allowedIPs),
    },
    hasPsk: data.peer.presharedKey === WG_SECRET_MASK,
  }
}

function applyLoaded(data: WireGuardClientConfig) {
  Object.assign(form, { ...data, peer: { ...data.peer } })
  text.addresses = joinList(data.addresses)
  text.dns = joinList(data.dns)
  text.allowedIPs = joinList(data.peer.allowedIPs)
  hasPsk.value = data.peer.presharedKey === WG_SECRET_MASK
  reservedNets.value = data.reservedNets || []
  resetSecrets()
  loadedEnabled = data.enabled
  loadedGlobal = data.routeMode === 'global'
  takeSnapshot(data)
}

async function load() {
  loading.value = true
  stopPoll()
  try {
    const data = unwrap(await getRouterApi().getWireGuardClient())
    applyLoaded(data)
    startPoll()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

/** 重置未保存编辑，不额外请求接口 */
function resetForm() {
  if (!snapshot) return
  Object.assign(form, { ...snapshot.form, peer: { ...snapshot.form.peer } })
  text.addresses = snapshot.text.addresses
  text.dns = snapshot.text.dns
  text.allowedIPs = snapshot.text.allowedIPs
  hasPsk.value = snapshot.hasPsk
  resetSecrets()
}

function secretValue(action: SecretAction, input: string, stored: boolean): string {
  if (action === 'generate') return 'generate'
  if (action === 'clear') return ''
  if (action === 'set') return input.trim()
  return stored ? WG_SECRET_MASK : ''
}

function payload(): WireGuardClientConfig {
  return {
    enabled: form.enabled,
    privateKey: secretValue(secrets.privateAction, secrets.privateKey, !!form.hasPrivateKey),
    publicKey: form.publicKey,
    addresses: splitList(text.addresses),
    dns: splitList(text.dns),
    useDns: form.useDns,
    mtu: Number(form.mtu),
    routeMode: form.routeMode,
    allowGlobalRoute: form.routeMode === 'global' && form.allowGlobalRoute,
    peer: {
      publicKey: form.peer.publicKey.trim(),
      presharedKey: secretValue(secrets.pskAction, secrets.psk, hasPsk.value),
      endpointHost: form.peer.endpointHost.trim(),
      endpointPort: Number(form.peer.endpointPort),
      allowedIPs: form.routeMode === 'global' ? [] : splitList(text.allowedIPs),
      keepalive: Number(form.peer.keepalive),
    },
  }
}

async function save() {
  if (form.enabled && !form.hasPrivateKey && secrets.privateAction === 'keep' && !secrets.privateKey.trim()) {
    toast.error(t('wg.needPrivateKey'))
    return
  }
  if (form.enabled && form.routeMode === 'global' && !form.allowGlobalRoute) {
    toast.error(t('wg.globalNeedsConsent'))
    return
  }
  if (form.enabled && form.routeMode === 'global' && !loadedGlobal) {
    globalOpen.value = true
    return
  }
  await commitSave()
}

async function commitSave() {
  globalOpen.value = false
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateWireGuardClient(payload()))
    resetSecrets()
    notifySaved(result, 'wg.clientApplied')
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

async function saveConfig() {
  await save()
}

async function setConnection(enabled: boolean) {
  if (enabled && !serviceOk.value) {
    toast.error(form.serviceMessage || t('wg.failMissing'))
    return
  }
  form.enabled = enabled
  await save()
}

function onEnableToggle(next: boolean) {
  if (next && !serviceOk.value) return
  form.enabled = next
}

function setPrivateInput(value: string) {
  secrets.privateKey = value
  secrets.privateAction = value.trim() ? 'set' : 'keep'
}

function setPskInput(value: string) {
  secrets.psk = value
  secrets.pskAction = value.trim() ? 'set' : 'keep'
}

function requestGenerate() {
  if (secrets.privateAction === 'generate') {
    secrets.privateAction = 'keep'
    secrets.privateKey = ''
    return
  }
  generateOpen.value = true
}

function confirmGenerate() {
  secrets.privateAction = 'generate'
  secrets.privateKey = ''
  generateOpen.value = false
}

async function copyPublicKey() {
  if (!form.publicKey) return
  if (await copyText(form.publicKey)) toast.success(t('wg.copied'))
  else toast.error(t('wg.copyFailed'))
}

function openImport() {
  importText.value = ''
  importOpen.value = true
}

function closeImport() {
  importText.value = ''
  importOpen.value = false
  if (fileInput.value) fileInput.value.value = ''
}

async function pickFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 8192) {
    toast.error(t('wg.importTooLarge'))
    return
  }
  importText.value = await file.text()
}

async function runImport() {
  if (!importText.value.trim()) {
    toast.error(t('wg.importEmpty'))
    return
  }
  importing.value = true
  try {
    const result = unwrap(await getRouterApi().importWireGuardClient(importText.value))
    closeImport()
    for (const warning of result.warnings ?? []) toast.warning(warning)
    notifySaved(result, 'wg.imported')
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    importing.value = false
  }
}

onMounted(() => void load())
onUnmounted(() => {
  stopPoll()
  resetSecrets()
  importText.value = ''
})
</script>

<template>
  <div class="wg-page">
    <ApplyBanner
      v-if="pending"
      :remaining="remaining"
      :phase="pending?.phase"
      :message="pending?.message"
      :applying="applying"
      @confirm="confirm"
      @cancel="cancel"
    />
    <LoadingState v-if="loading" />
    <template v-else>
      <div class="wg-content">
        <!-- 顶部：运行状态（只读/轮询） -->
        <UiCard class="wg-card" icon="activity" :title="t('wg.statusTitle')">
          <template #actions>
            <StatusBadge :status="statusBadge.status" :label="statusBadge.label" />
          </template>
          <div class="status-grid">
            <div class="status-item">
              <span class="status-label">{{ t('wg.enableClient') }}</span>
              <span class="status-value">{{ applied ? t('common.on') : t('common.off') }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.tunnelAddress') }}</span>
              <span class="status-value">{{ client?.address || '—' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.endpoint') }}</span>
              <span class="status-value">{{ applied ? (client?.endpoint || '—') : '—' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.ifaceState') }}</span>
              <span class="status-value">{{ applied ? (client?.up ? t('wg.ifaceUp') : t('wg.ifaceDown')) : '—' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.latestHandshake') }}</span>
              <span class="status-value">{{ applied ? handshakeText(client ?? undefined, t) : '—' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.rx') }}</span>
              <span class="status-value">{{ applied ? trafficRx(client ?? undefined) : '—' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.tx') }}</span>
              <span class="status-value">{{ applied ? trafficTx(client ?? undefined) : '—' }}</span>
            </div>
            <div class="status-item">
              <span class="status-label">{{ t('wg.probe') }}</span>
              <span class="status-value">{{ applied ? probeText(client?.probe, t) : '—' }}</span>
            </div>
          </div>
          <p v-if="failText" class="fail">{{ t('wg.failReason') }}：{{ failText }}</p>
          <p v-if="kind === 'handshake-stale'" class="hint-line">{{ t('wg.staleHint') }}</p>
        </UiCard>

        <!-- 中部：双列配置 -->
        <div class="form-grid">
          <UiCard class="wg-card" icon="vpn" :title="t('wg.sectionInterface')">
            <template #actions>
              <UiButton class="import-btn" variant="secondary" :disabled="!!pending" @click="openImport">
                {{ t('wg.importConfig') }}
              </UiButton>
            </template>
            <div class="form-body">
              <div class="form-group">
                <div class="form-label">{{ t('wg.enableClient') }}</div>
                <label class="switch" :class="{ disabled: !serviceOk }" :title="serviceOk ? undefined : t('wg.enableBlockedHint')">
                  <input
                    type="checkbox"
                    :checked="form.enabled"
                    :disabled="!serviceOk"
                    @change="onEnableToggle(($event.target as HTMLInputElement).checked)"
                  />
                  <span class="slider" />
                  <span class="state">{{ serviceOk ? (form.enabled ? t('common.on') : t('common.off')) : t('wg.enableBlockedHint') }}</span>
                </label>
              </div>

              <div class="form-group">
                <div class="form-label">{{ t('wg.privateKey') }}</div>
                <div class="input-group">
                  <input
                    class="form-control secret"
                    type="password"
                    :value="secrets.privateKey"
                    :placeholder="form.hasPrivateKey ? WG_SECRET_MASK : t('wg.privateKeyPlaceholder')"
                    :disabled="secrets.privateAction === 'generate'"
                    autocomplete="off"
                    spellcheck="false"
                    data-lpignore="true"
                    data-1p-ignore
                    @input="setPrivateInput(($event.target as HTMLInputElement).value)"
                  />
                  <UiButton variant="secondary" @click="requestGenerate">
                    {{ secrets.privateAction === 'generate' ? t('common.cancel') : t('wg.generate') }}
                  </UiButton>
                </div>
                <p class="help-text">
                  {{
                    secrets.privateAction === 'generate'
                      ? t('wg.willGenerate')
                      : form.hasPrivateKey
                        ? t('wg.privateKeyStored')
                        : t('wg.privateKeyEmpty')
                  }}
                </p>
              </div>

              <div class="form-group">
                <div class="form-label">{{ t('wg.publicKey') }}</div>
                <div class="input-group">
                  <input class="form-control mono" :value="form.publicKey || '—'" readonly />
                  <button class="icon-action" type="button" :disabled="!form.publicKey" :title="t('wg.copy')" :aria-label="t('wg.copy')" @click="copyPublicKey">
                    <UiIcon name="copy" :size="16" />
                  </button>
                </div>
                <p class="help-text">{{ t('wg.publicKeyHint') }}</p>
              </div>

              <div class="form-group">
                <div class="form-label">{{ t('wg.tunnelAddress') }}</div>
                <input v-model="text.addresses" class="form-control" placeholder="10.73.0.2/32, fd00::2/64" autocomplete="off" />
                <p class="help-text">{{ t('wg.addressHint') }}</p>
              </div>

              <details class="advanced-options">
                <summary>{{ t('wg.advancedOptions') }}</summary>
                <div class="advanced-content">
                  <div class="form-group">
                    <div class="form-label">{{ t('wg.mtu') }}</div>
                    <input v-model.number="form.mtu" class="form-control" type="number" min="1280" max="1500" />
                  </div>
                  <div class="form-group">
                    <div class="form-label">{{ t('wg.useDns') }}</div>
                    <label class="switch">
                      <input v-model="form.useDns" type="checkbox" />
                      <span class="slider" />
                      <span class="state">{{ form.useDns ? t('common.on') : t('common.off') }}</span>
                    </label>
                  </div>
                  <div v-if="form.useDns" class="form-group">
                    <div class="form-label">{{ t('wg.dns') }}</div>
                    <input v-model="text.dns" class="form-control" placeholder="10.73.0.1" autocomplete="off" />
                    <p class="help-text">{{ t('wg.dnsHint') }}</p>
                  </div>
                </div>
              </details>
            </div>
          </UiCard>

          <UiCard class="wg-card" icon="globe" :title="t('wg.sectionPeer')">
            <div class="form-body">
              <div class="form-group">
                <div class="form-label">{{ t('wg.peerPublicKey') }}</div>
                <input v-model="form.peer.publicKey" class="form-control mono" maxlength="44" autocomplete="off" spellcheck="false" />
              </div>
              <div class="form-group">
                <div class="form-label">{{ t('wg.endpointHost') }}</div>
                <input v-model="form.peer.endpointHost" class="form-control" maxlength="253" placeholder="vpn.example.com" autocomplete="off" />
              </div>
              <div class="form-group">
                <div class="form-label">{{ t('wg.endpointPort') }}</div>
                <input v-model.number="form.peer.endpointPort" class="form-control" type="number" min="1" max="65535" />
              </div>

              <details class="advanced-options">
                <summary>{{ t('wg.advancedOptions') }}</summary>
                <div class="advanced-content">
                  <div class="form-group">
                    <div class="form-label">{{ t('wg.presharedKey') }}</div>
                    <div class="input-group">
                      <input
                        class="form-control secret"
                        type="password"
                        :value="secrets.psk"
                        :placeholder="hasPsk ? WG_SECRET_MASK : t('wg.optional')"
                        :disabled="secrets.pskAction === 'generate' || secrets.pskAction === 'clear'"
                        autocomplete="off"
                        spellcheck="false"
                        data-lpignore="true"
                        data-1p-ignore
                        @input="setPskInput(($event.target as HTMLInputElement).value)"
                      />
                      <UiButton v-if="hasPsk && secrets.pskAction === 'keep'" variant="secondary" @click="secrets.pskAction = 'clear'">{{ t('wg.clear') }}</UiButton>
                      <UiButton v-else-if="secrets.pskAction === 'clear' || secrets.pskAction === 'generate'" variant="secondary" @click="secrets.pskAction = 'keep'">{{ t('common.cancel') }}</UiButton>
                    </div>
                    <p class="help-text">
                      {{
                        secrets.pskAction === 'clear'
                          ? t('wg.willClear')
                          : hasPsk
                            ? t('wg.pskStored')
                            : t('wg.optional')
                      }}
                    </p>
                  </div>
                  <div class="form-group">
                    <div class="form-label">{{ t('wg.keepalive') }}</div>
                    <input v-model.number="form.peer.keepalive" class="form-control" type="number" min="0" max="600" />
                    <p class="help-text">{{ t('wg.keepaliveHint') }}</p>
                  </div>
                </div>
              </details>
            </div>
          </UiCard>
        </div>

        <!-- 下部：路由配置 -->
        <UiCard class="wg-card" icon="route" :title="t('wg.sectionRouting')">
          <div class="form-body">
            <div class="form-group">
              <div class="form-label">{{ t('wg.routeMode') }}</div>
              <div class="radios">
                <label class="radio"><input v-model="form.routeMode" type="radio" value="split" /><span>{{ t('wg.routeSplit') }}</span></label>
                <label class="radio"><input v-model="form.routeMode" type="radio" value="global" /><span>{{ t('wg.routeGlobal') }}</span></label>
              </div>
              <p class="help-text">{{ t('wg.routeModeHint') }}</p>
            </div>

            <div v-if="form.routeMode === 'global'" class="alert alert-warning">
              <div>
                <p>{{ t('wg.globalWarning') }}</p>
                <p>{{ t('wg.protectHint') }}</p>
                <label class="check">
                  <input v-model="form.allowGlobalRoute" type="checkbox" />
                  <span>{{ t('wg.allowGlobalRoute') }}</span>
                </label>
              </div>
            </div>

            <div v-if="form.routeMode === 'split'" class="form-group">
              <div class="form-label">{{ t('wg.allowedIPs') }}</div>
              <textarea v-model="text.allowedIPs" class="form-control" rows="3" placeholder="10.73.0.0/24, 192.168.50.0/24" spellcheck="false" />
              <p class="help-text">{{ t('wg.allowedIPsHint') }}</p>
              <p v-if="conflicts.length" class="conflict">
                {{ t('wg.routeConflict', { nets: conflicts.map((n) => `${n.label} ${n.cidr}`).join('、') }) }}
              </p>
            </div>
          </div>
        </UiCard>
      </div>

      <!-- 底部操作区 -->
      <div class="bottom-actions">
        <UiButton variant="secondary" :disabled="busy" @click="resetForm">{{ t('wg.resetForm') }}</UiButton>
        <UiButton variant="primary" :disabled="busy" @click="saveConfig">
          {{ saving ? t('common.saving') : t('wg.saveConfig') }}
        </UiButton>
        <UiButton
          v-if="!form.enabled"
          class="btn-enable"
          variant="secondary"
          :disabled="busy || !serviceOk"
          @click="setConnection(true)"
        >
          {{ t('wg.enableConnection') }}
        </UiButton>
        <UiButton
          v-else
          variant="secondary"
          :disabled="busy"
          @click="setConnection(false)"
        >
          {{ t('wg.disableConnection') }}
        </UiButton>
      </div>
    </template>

    <UiModal
      :open="generateOpen"
      size="sm"
      danger
      :title="t('wg.generate')"
      :confirm-label="t('wg.generate')"
      @close="generateOpen = false"
      @confirm="confirmGenerate"
    >
      <p class="modal-body">{{ form.hasPrivateKey ? t('wg.generateWarningStored') : t('wg.generateWarningNew') }}</p>
    </UiModal>

    <UiModal
      :open="globalOpen"
      size="sm"
      danger
      :title="t('wg.routeGlobal')"
      :confirm-label="t('wg.allowGlobalRoute')"
      @close="globalOpen = false"
      @confirm="commitSave"
    >
      <p class="modal-body">{{ t('wg.globalConfirmBody') }}</p>
    </UiModal>

    <UiModal
      :open="importOpen"
      size="md"
      :title="t('wg.importConfig')"
      :confirm-disabled="importing"
      :confirm-label="importing ? t('common.saving') : t('wg.import')"
      @close="closeImport"
      @confirm="runImport"
    >
      <div class="import">
        <p class="help-text">{{ t('wg.importHint') }}</p>
        <input ref="fileInput" class="hidden" type="file" accept=".conf,text/plain" @change="pickFile" />
        <UiButton variant="secondary" @click="fileInput?.click()">{{ t('wg.pickConfFile') }}</UiButton>
        <textarea v-model="importText" class="form-control conf" rows="10" spellcheck="false" autocomplete="off" :placeholder="'[Interface]\nPrivateKey = …\nAddress = 10.73.0.2/32\n\n[Peer]\nPublicKey = …\nEndpoint = vpn.example.com:51820\nAllowedIPs = 10.73.0.0/24'" />
      </div>
    </UiModal>
  </div>
</template>

<style scoped>
.wg-page {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  max-width: 1360px;
  min-height: 100%;
}

.wg-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 16px;
}

.wg-page :deep(.wg-card > .head) {
  box-sizing: border-box;
  min-height: 56px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border);
  align-items: center;
}

.wg-page :deep(.wg-card > .body) {
  padding: 20px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.form-grid > :deep(.wg-card) {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.form-grid > :deep(.wg-card > .body) {
  flex: 1;
}

.form-grid :deep(.import-btn) {
  height: 32px;
  min-height: 32px;
  padding: 0 12px;
  font-size: 13px;
  line-height: 1;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-label {
  font-size: 12px;
  color: var(--color-muted);
}

.status-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-title);
  word-break: break-all;
}

.alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 16px;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.alert p {
  margin: 0 0 8px;
}

.alert-danger {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.alert-warning {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #b45309;
}

.form-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text);
}

.form-control {
  display: block;
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 14px;
  line-height: 1.4;
}

textarea.form-control {
  height: auto;
  min-height: 80px;
  padding: 10px 12px;
  resize: vertical;
}

.form-control:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
}

.form-control:disabled,
.form-control[readonly] {
  background: var(--color-bg-muted);
  color: var(--color-muted);
  cursor: not-allowed;
  border-color: var(--color-border);
}

.help-text {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-muted);
  line-height: 1.4;
}

.input-group {
  display: flex;
  gap: 8px;
  align-items: center;
}

.input-group .form-control {
  flex: 1;
  min-width: 0;
}

.advanced-options {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-border);
}

.advanced-options summary {
  display: flex;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-muted);
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.advanced-options summary::-webkit-details-marker {
  display: none;
}

.advanced-options summary::before {
  content: '▶';
  margin-right: 6px;
  color: var(--color-muted);
  font-size: 10px;
  transition: transform 0.15s ease;
}

.advanced-options[open] summary::before {
  transform: rotate(90deg);
}

.advanced-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 16px;
}

.advanced-content .form-group {
  margin-bottom: 0;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.switch.disabled {
  cursor: not-allowed;
  opacity: 0.75;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  background: var(--color-border);
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}

.switch input:checked + .slider {
  background: var(--color-primary);
}

.switch input:checked + .slider::before {
  transform: translateX(18px);
}

.switch .state {
  font-size: 14px;
  color: var(--color-muted);
}

.mono,
.secret,
.conf {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.icon-action {
  display: inline-grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-primary);
  background: var(--color-surface);
  cursor: pointer;
  flex-shrink: 0;
}

.icon-action:disabled {
  color: var(--color-muted);
  cursor: not-allowed;
}

.icon-action:hover:not(:disabled) {
  background: var(--color-primary-soft);
}

.radios {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding-top: 4px;
}

.radio,
.check {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  cursor: pointer;
  font-size: 14px;
}

.fail {
  margin: 12px 0 0;
  color: var(--color-danger);
  font-size: 12px;
}

.hint-line,
.conflict {
  margin: 8px 0 0;
  color: var(--color-warning);
  font-size: 12px;
  line-height: 1.5;
}

.bottom-actions {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
  padding: 16px 20px 16px 20px;
  backdrop-filter: blur(8px);
  border-top: 1px solid var(--color-border);
  background: #fff;
}

.bottom-actions :deep(.btn) {
  min-width: 112px;
}

.bottom-actions :deep(.btn-enable.btn),
.bottom-actions :deep(.btn.btn-enable) {
  background: #10b981;
  border-color: #10b981;
  color: #fff;
}

.bottom-actions :deep(.btn-enable.btn:hover:not(:disabled)),
.bottom-actions :deep(.btn.btn-enable:hover:not(:disabled)) {
  background: #059669;
  border-color: #059669;
}

.bottom-actions :deep(.btn-enable.btn:disabled),
.bottom-actions :deep(.btn.btn-enable:disabled) {
  opacity: 0.55;
}

.import {
  display: grid;
  gap: 12px;
}

.import .conf {
  min-height: 200px;
}

.modal-body {
  margin: 0;
  line-height: 1.6;
}

.hidden {
  display: none;
}

@media (max-width: 1024px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .status-grid {
    grid-template-columns: 1fr;
  }

  .bottom-actions {
    justify-content: stretch;
  }

  .bottom-actions :deep(.btn) {
    flex: 1;
    min-width: 0;
  }
}
</style>
