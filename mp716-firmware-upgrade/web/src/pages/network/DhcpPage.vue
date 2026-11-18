<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import UiIcon from '@/components/UiIcon.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ConnectedDevice, DhcpConfig, StaticDhcpBinding } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { isIpv4 } from '@/utils/validate'

function poolLimitFromIps(startIp: string, endIp: string): number {
  const toInt = (ip: string) => {
    if (!isIpv4(ip)) return null
    return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0)
  }
  const start = toInt(startIp)
  const end = toInt(endIp)
  if (start == null || end == null || end < start) return 0
  return end - start + 1
}

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const savingStatic = ref(false)
const scanning = ref(false)
const form = reactive({
  enabled: true,
  startIp: '192.168.199.1',
  endIp: '192.168.199.254',
  leasetime: '7200' as string | number,
})
const minIp = ref('')
const maxIp = ref('')
const staticBindings = ref<StaticDhcpBinding[]>([])
const showAdd = ref(false)
const showScan = ref(false)
const editIndex = ref(-1)
const scanRows = ref<ConnectedDevice[]>([])
const draft = reactive({ ipv4: '', mac: '', hostname: '' })

const poolHint = computed(() => {
  if (!minIp.value || !maxIp.value) return ''
  return t('dhcp.poolHint', { min: minIp.value, max: maxIp.value })
})
const modalTitle = computed(() =>
  editIndex.value >= 0 ? t('dhcp.modalEditTitle') : t('dhcp.modalTitle'),
)

async function load(quiet = false) {
  if (!quiet) loading.value = true
  try {
    const dhcp = unwrap(await getRouterApi().getDhcpConfig())
    form.enabled = dhcp.enabled
    form.startIp = dhcp.startIp || form.startIp
    form.endIp = dhcp.endIp || form.endIp
    form.leasetime = dhcp.leasetime || form.leasetime
    minIp.value = dhcp.minIp || ''
    maxIp.value = dhcp.maxIp || ''
    staticBindings.value = dhcp.staticBindings ? [...dhcp.staticBindings] : []
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    if (!quiet) loading.value = false
  }
}

function toDhcpConfig(): DhcpConfig {
  const startIp = form.startIp.trim()
  const endIp = form.endIp.trim()
  return {
    enabled: form.enabled,
    start: Number(startIp.split('.').pop()) || 0,
    limit: poolLimitFromIps(startIp, endIp),
    leasetime: String(form.leasetime).trim(),
    gateway: '',
    dns: [],
    leases: [],
    startIp,
    endIp,
  }
}

async function save() {
  if (!isIpv4(form.startIp) || !isIpv4(form.endIp)) {
    toast.error(t('dhcp.errInvalidIp'))
    return
  }
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateDhcpConfig(toDhcpConfig()))
    notifySaved(result, 'common.configApplied')
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load(true)
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

function openAdd() {
  editIndex.value = -1
  draft.ipv4 = ''
  draft.mac = ''
  draft.hostname = ''
  showScan.value = false
  showAdd.value = true
}

function openEdit(index: number) {
  const row = staticBindings.value[index]
  if (!row) return
  editIndex.value = index
  draft.ipv4 = row.ipv4
  draft.mac = row.mac
  draft.hostname = row.hostname || ''
  showScan.value = false
  showAdd.value = true
}

function closeAdd() {
  showAdd.value = false
  showScan.value = false
  editIndex.value = -1
  draft.ipv4 = ''
  draft.mac = ''
  draft.hostname = ''
}

async function openScan() {
  scanning.value = true
  showScan.value = true
  try {
    scanRows.value = unwrap(await getRouterApi().getConnectedDevices())
  } catch (e) {
    toast.error(formatApiError(e, t))
    scanRows.value = []
  } finally {
    scanning.value = false
  }
}

function pickScan(row: ConnectedDevice) {
  draft.ipv4 = row.ipv4 || draft.ipv4
  draft.mac = row.mac || draft.mac
  draft.hostname = row.hostname || draft.hostname
  showScan.value = false
}

async function commitStatic(next: StaticDhcpBinding[]) {
  savingStatic.value = true
  try {
    const result = unwrap(await getRouterApi().updateDhcpStaticBindings(next))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    staticBindings.value = next
    notifySaved(result, 'dhcp.staticSaved')
    closeAdd()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    savingStatic.value = false
  }
}

async function addStatic() {
  const ipv4 = draft.ipv4.trim()
  const mac = draft.mac.trim().toUpperCase()
  if (!isIpv4(ipv4) || !mac) {
    toast.error(t('dhcp.errIpMac'))
    return
  }
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    toast.error(t('validation.macFormat'))
    return
  }
  const entry = { ipv4, mac, hostname: draft.hostname.trim() }
  if (editIndex.value >= 0) {
    const next = staticBindings.value.map((row, i) => (i === editIndex.value ? entry : row))
    await commitStatic(next)
    return
  }
  await commitStatic([...staticBindings.value, entry])
}

async function removeStatic(index: number) {
  const next = staticBindings.value.filter((_, i) => i !== index)
  await commitStatic(next)
}

onMounted(() => void load())
</script>

<template>
  <div>
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <template v-else>
      <UiCard class="mb">
        <div class="settings-form dhcp-form">
          <UiFormRow :label="t('dhcp.dhcpService')">
            <div>
              <label class="switch dhcp-switch">
                <input v-model="form.enabled" type="checkbox" />
                <span class="slider" />
              </label>
              <div v-if="poolHint && form.enabled" class="alert-info">{{ poolHint }}</div>
            </div>
          </UiFormRow>

          <UiField layout="horizontal" :label="t('dhcp.startIp')">
            <input v-model="form.startIp" :disabled="!form.enabled" />
          </UiField>
          <UiField layout="horizontal" :label="t('dhcp.endIp')">
            <input v-model="form.endIp" :disabled="!form.enabled" />
          </UiField>
          <UiField layout="horizontal" :label="t('dhcp.leasetime')">
            <div class="lease-row">
              <input
                v-model="form.leasetime"
                class="lease-input"
                type="number"
                min="300"
                max="604800"
                :disabled="!form.enabled"
              />
              <span class="lease-unit">{{ t('common.second') }}</span>
            </div>
          </UiField>

          <FormActions :loading="saving" @apply="save" />
        </div>
      </UiCard>

      <UiCard>
        <div class="table-header">
          <h3 class="table-title">{{ t('dhcp.staticTitle') }}</h3>
          <UiButton variant="secondary" @click="openAdd">{{ t('dhcp.addBinding') }}</UiButton>
        </div>

        <div class="table-wrapper">
          <table class="bind-table">
            <thead>
              <tr>
                <th>{{ t('common.ip') }}</th>
                <th>{{ t('common.mac') }}</th>
                <th>{{ t('common.hostname') }}</th>
                <th>{{ t('dhcp.leaseCol') }}</th>
                <th class="op">{{ t('common.action') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!staticBindings.length">
                <td colspan="5" class="table-empty">{{ t('dhcp.emptyStatic') }}</td>
              </tr>
              <tr v-for="(row, index) in staticBindings" :key="row.mac + row.ipv4">
                <td>{{ row.ipv4 }}</td>
                <td class="mono">{{ row.mac }}</td>
                <td>{{ row.hostname || '—' }}</td>
                <td>{{ t('dhcp.permanent') }}</td>
                <td class="op">
                  <div class="op-actions">
                    <button
                      class="icon-action"
                      type="button"
                      :disabled="savingStatic"
                      :title="t('common.edit')"
                      :aria-label="t('common.edit')"
                      @click="openEdit(index)"
                    >
                      <UiIcon name="edit" :size="18" />
                    </button>
                    <button
                      class="icon-action unlock"
                      type="button"
                      :disabled="savingStatic"
                      :title="t('common.delete')"
                      :aria-label="t('common.delete')"
                      @click="removeStatic(index)"
                    >
                      <UiIcon name="trash" :size="18" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiCard>
    </template>

    <Teleport to="body">
    <div v-if="showAdd" class="mask" @click.self="closeAdd">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="modalTitle">
        <header class="modal-head">
          <h3>{{ modalTitle }}</h3>
          <button class="close-btn" type="button" :aria-label="t('dhcp.closeAria')" @click="closeAdd">×</button>
        </header>

        <div class="modal-body settings-form">
          <UiField layout="horizontal" :label="t('common.ip')">
            <input v-model="draft.ipv4" placeholder="" />
          </UiField>
          <UiField layout="horizontal" :label="t('common.mac')">
            <input v-model="draft.mac" placeholder="" />
          </UiField>
          <UiField layout="horizontal" :label="t('common.hostname')">
            <input v-model="draft.hostname" maxlength="32" placeholder="" />
          </UiField>

          <div class="scan-row">
            <span class="scan-spacer" />
            <button class="scan-btn" type="button" :disabled="scanning" @click="openScan">
              {{ scanning ? t('common.scan.scanning') : t('common.scan.start') }}
            </button>
          </div>

          <div v-if="showScan" class="scan-panel">
            <div class="scan-panel-head">
              <strong>{{ t('common.scan.pick') }}</strong>
              <button type="button" class="link-btn" @click="showScan = false">{{ t('common.scan.collapse') }}</button>
            </div>
            <p v-if="scanning" class="scan-empty">{{ t('common.scan.scanning') }}</p>
            <p v-else-if="!scanRows.length" class="scan-empty">{{ t('common.scan.empty') }}</p>
            <ul v-else class="scan-list">
              <li v-for="row in scanRows" :key="row.id || row.mac">
                <button type="button" @click="pickScan(row)">
                  <span class="scan-name">{{ row.hostname || row.mac }}</span>
                  <span class="scan-meta">{{ row.ipv4 || '—' }} · {{ row.mac }}</span>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <footer class="modal-foot">
          <button class="ghost-btn" type="button" @click="closeAdd">{{ t('common.cancel') }}</button>
          <button class="ghost-btn" type="button" :disabled="savingStatic" @click="addStatic">
            {{ savingStatic ? t('common.saving') : t('common.ok') }}
          </button>
        </footer>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mb {
  margin-bottom: 16px;
}

.dhcp-switch {
  display: inline-flex;
  align-items: center;
}

.alert-info {
  margin-top: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, transparent);
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 13px;
  line-height: 1.4;
}

.lease-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lease-input {
  max-width: 200px !important;
}

.lease-unit {
  color: var(--color-muted);
  font-size: 13px;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 12px;
}

.table-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-title);
}

.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.bind-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.bind-table th {
  background: var(--color-table-head);
  padding: 12px 16px;
  font-weight: 500;
  color: var(--color-muted);
  font-size: 13px;
  border-bottom: 1px solid var(--color-border);
}

.bind-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-title);
}

.bind-table tr:last-child td {
  border-bottom: none;
}

.bind-table tbody tr:hover {
  background: var(--color-row-hover);
}

.bind-table .op {
  width: 100px;
  text-align: center;
}

.table-empty {
  padding: 32px 16px !important;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}

.op-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

.mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
}

.modal {
  width: min(520px, 100%);
  background: var(--color-surface);
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(15, 23, 42, 0.18);
  overflow: hidden;
}

.modal-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px 48px 14px;
  border-bottom: 1px solid var(--color-border);
}

.modal-head h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-primary);
}

.close-btn {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
  background: var(--color-bg-soft);
  color: var(--color-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.modal-body {
  padding: 20px 28px 8px;
}

.modal-body :deep(.field) {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  column-gap: 16px;
  margin-bottom: 16px;
}

.modal-body :deep(.label) {
  padding-top: 0;
  font-weight: 500;
  color: var(--color-text);
}

.modal-body :deep(.control) {
  grid-column: 2;
}

.modal-body :deep(input) {
  height: 40px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--color-bg-muted);
  color: var(--color-title);
  padding: 0 16px;
}

.modal-body :deep(input:focus) {
  outline: none;
  border-color: var(--color-primary);
  background: var(--color-surface);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.scan-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  column-gap: 16px;
  margin-bottom: 12px;
}

.scan-btn {
  height: 40px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.scan-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.scan-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.scan-panel {
  margin: 0 0 12px 104px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-surface);
}

.scan-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-soft);
}

.scan-empty {
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}

.scan-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 220px;
  overflow: auto;
}

.scan-list button {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  background: transparent;
  text-align: left;
  padding: 10px 12px;
  cursor: pointer;
}

.scan-list li:last-child button {
  border-bottom: 0;
}

.scan-list button:hover {
  background: var(--color-primary-soft);
}

.scan-name {
  display: block;
  color: var(--color-title);
  font-weight: 500;
}

.scan-meta {
  display: block;
  margin-top: 2px;
  color: var(--color-muted);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.modal-foot {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 8px 28px 24px;
}

.ghost-btn {
  height: 42px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
}

.ghost-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.ghost-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.link-btn {
  border: 0;
  background: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  font-size: 13px;
}

@media (max-width: 640px) {
  .scan-panel {
    margin-left: 0;
  }

  .modal-body :deep(.field),
  .scan-row,
  .form-group,
  .dhcp-form :deep(.field) {
    grid-template-columns: 1fr;
  }

  .scan-spacer {
    display: none;
  }
}
</style>
