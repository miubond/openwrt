<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import UiIcon from '@/components/UiIcon.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ConnectedDevice, WirelessAclEntry, WirelessAclMode } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm(() => void load())
const loading = ref(true)
const savingMode = ref(false)
const savingList = ref(false)
const scanning = ref(false)
const mode = ref<WirelessAclMode>('disable')
const savedMode = ref<WirelessAclMode>('disable')
const rows = ref<WirelessAclEntry[]>([])
const showAdd = ref(false)
const showScan = ref(false)
const editIndex = ref(-1)
const scanRows = ref<ConnectedDevice[]>([])
const draft = reactive({ mac: '' })
const modalTitle = computed(() =>
  editIndex.value >= 0 ? t('wifiMac.modalEditTitle') : t('wifiMac.modalTitle'),
)

const modeOptions = computed((): { value: WirelessAclMode; label: string }[] => [
  { value: 'disable', label: t('common.disabled') },
  { value: 'allow', label: t('wifiMac.modeAllow') },
  { value: 'deny', label: t('wifiMac.modeDeny') },
])

const modeDirty = computed(() => mode.value !== savedMode.value)
const modeHint = computed(() => {
  if (mode.value === 'allow') return t('wifiMac.hintAllow')
  if (mode.value === 'deny') return t('wifiMac.hintDeny')
  return t('wifiMac.hintDisable')
})

function policyOf(m: WirelessAclMode): 'allow' | 'deny' {
  return m === 'allow' ? 'allow' : 'deny'
}

async function load() {
  loading.value = true
  try {
    const cfg = unwrap(await getRouterApi().getWirelessAcl())
    mode.value = cfg.mode
    savedMode.value = cfg.mode
    rows.value = cfg.entries.map((row) => ({
      ...row,
      policy: policyOf(cfg.mode),
    }))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function saveMode() {
  savingMode.value = true
  try {
    const result = unwrap(
      await getRouterApi().updateWirelessAcl({
        mode: mode.value,
        entries: rows.value,
      }),
    )
    savedMode.value = mode.value
    toast.success(t('wifiMac.appliedMode'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    savingMode.value = false
  }
}

async function commitList(next: WirelessAclEntry[]) {
  savingList.value = true
  try {
    const result = unwrap(
      await getRouterApi().updateWirelessAcl({
        mode: mode.value,
        entries: next,
      }),
    )
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    rows.value = next
    toast.success(t('wifiMac.appliedList'))
    closeAdd()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    savingList.value = false
  }
}

function openAdd() {
  editIndex.value = -1
  draft.mac = ''
  showScan.value = false
  showAdd.value = true
}

function openEdit(index: number) {
  const row = rows.value[index]
  if (!row) return
  editIndex.value = index
  draft.mac = row.mac
  showScan.value = false
  showAdd.value = true
}

function closeAdd() {
  showAdd.value = false
  showScan.value = false
  editIndex.value = -1
  draft.mac = ''
}

async function openScan() {
  scanning.value = true
  showScan.value = true
  try {
    const devices = unwrap(await getRouterApi().getConnectedDevices())
    scanRows.value = devices.filter((d) => d.wired !== true)
  } catch (e) {
    toast.error(formatApiError(e, t))
    scanRows.value = []
  } finally {
    scanning.value = false
  }
}

function pickScan(row: ConnectedDevice) {
  draft.mac = row.mac || draft.mac
  showScan.value = false
}

async function addMac() {
  const mac = draft.mac.trim().toUpperCase()
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    toast.error(t('validation.macFormat'))
    return
  }
  const editing = editIndex.value >= 0
  const duplicate = rows.value.some(
    (row, i) => row.mac.toUpperCase() === mac && (!editing || i !== editIndex.value),
  )
  if (duplicate) {
    toast.error(t('wifiMac.errDuplicate'))
    return
  }
  if (editing) {
    const next = rows.value.map((row, i) =>
      i === editIndex.value ? { ...row, id: mac, mac, policy: policyOf(mode.value) } : row,
    )
    await commitList(next)
    return
  }
  if (rows.value.length >= 10) {
    toast.error(t('wifiMac.errMaxRules'))
    return
  }
  await commitList([
    ...rows.value,
    { id: mac, mac, policy: policyOf(mode.value) },
  ])
}

async function removeRow(index: number) {
  await commitList(rows.value.filter((_, i) => i !== index))
}

onMounted(() => void load())
</script>

<template>
  <div>
    <p class="page-desc">{{ t('wifiMac.desc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <template v-else>
      <UiCard class="mb">
        <div class="settings-form acl-form">
          <UiField layout="horizontal" :label="t('wifiMac.accessRule')">
            <UiSelect v-model="mode" :options="modeOptions" />
          </UiField>
          <div class="mode-hint-row">
            <p class="mode-hint">{{ modeHint }}</p>
          </div>
          <FormActions :loading="savingMode" :disabled="!modeDirty" @apply="saveMode" />
        </div>
      </UiCard>

      <UiCard>
        <div class="table-header">
          <h3 class="table-title">{{ t('wifiMac.aclList') }}</h3>
          <UiButton variant="secondary" @click="openAdd">{{ t('wifiMac.add') }}</UiButton>
        </div>

        <div class="table-wrapper">
          <table class="bind-table">
            <thead>
              <tr>
                <th>{{ t('common.mac') }}</th>
                <th class="op">{{ t('common.action') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!rows.length">
                <td colspan="2" class="table-empty">{{ t('common.emptyRules') }}</td>
              </tr>
              <tr v-for="(row, index) in rows" :key="row.id || row.mac">
                <td class="mono">{{ row.mac }}</td>
                <td class="op">
                  <div class="op-actions">
                    <button
                      class="icon-action"
                      type="button"
                      :disabled="savingList"
                      :title="t('common.edit')"
                      :aria-label="t('common.edit')"
                      @click="openEdit(index)"
                    >
                      <UiIcon name="edit" :size="18" />
                    </button>
                    <button
                      class="icon-action unlock"
                      type="button"
                      :disabled="savingList"
                      :title="t('common.delete')"
                      :aria-label="t('common.delete')"
                      @click="removeRow(index)"
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

        <div class="modal-body settings-form modal-form">
          <UiField layout="horizontal" :label="t('common.mac')">
            <div class="mac-field-stack">
              <div class="mac-input-row">
                <input v-model="draft.mac" placeholder="00:1C:A3:36:43:53" autocomplete="off" spellcheck="false" />
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
                <p v-else-if="!scanRows.length" class="scan-empty">{{ t('wifiMac.scanEmptyWireless') }}</p>
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
          </UiField>
        </div>

        <footer class="modal-foot">
          <UiButton variant="secondary" class="foot-btn" @click="closeAdd">{{ t('common.cancel') }}</UiButton>
          <UiButton class="foot-btn" :disabled="savingList" @click="addMac">
            {{ savingList ? t('common.saving') : t('common.ok') }}
          </UiButton>
        </footer>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page-desc {
  margin: 0 0 16px;
  color: var(--color-muted);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
}

.mb {
  margin-bottom: 16px;
}

.acl-form {
  padding-bottom: 4px;
}

.modal-form {
  max-width: none;
}

.modal-form div.field {
  grid-template-columns: 96px minmax(0, 1fr);
  margin-bottom: 0;
}

.modal-form div.field > .label {
  padding-top: 10px;
}

.modal-form div.field > .control {
  max-width: none;
}

.mac-field-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.mac-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.mac-input-row input {
  flex: 1;
  min-width: 0;
  height: 40px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: var(--color-bg-muted);
  padding: 0 16px;
  font-family: var(--font-family-mono);
}

.mac-input-row input:focus {
  background: var(--color-surface);
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
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
  z-index: var(--z-modal, 300);
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
  padding: 22px 24px 18px;
}

.scan-btn {
  flex-shrink: 0;
  height: 40px;
  min-width: 88px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.scan-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
}

.scan-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.scan-panel {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
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
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 14px;
  padding: 16px 24px 22px;
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-soft);
}

.modal-foot :deep(.foot-btn) {
  flex: 1;
  max-width: 200px;
  min-height: 42px;
  border-radius: 999px;
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
  .modal-form div.field {
    grid-template-columns: 1fr;
  }

  .modal-form div.field > .label {
    padding-top: 0;
  }

  .mac-input-row {
    flex-direction: column;
    align-items: stretch;
  }

  .scan-btn {
    width: 100%;
  }

  .modal-foot {
    flex-direction: column;
  }

  .modal-foot :deep(.foot-btn) {
    max-width: none;
    width: 100%;
  }
}
</style>
