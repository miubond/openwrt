<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiSelect from '@/components/UiSelect.vue'
import UiIcon from '@/components/UiIcon.vue'
import UiModal from '@/components/UiModal.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { VpnUser, VpnUserConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const saving = ref(false)
const editorOpen = ref(false)
const deleteIndex = ref(-1)
const showPassword = ref(false)
const config = ref<VpnUserConfig | null>(null)
const typeOptions = computed(() =>
  (config.value?.types || []).map((type) => ({
    value: type,
    label: type.toUpperCase(),
  })),
)

const draft = reactive({
  index: -1,
  type: 'all',
  username: '',
  password: '',
  address: '',
  routes: '',
  comment: '',
})

const editorTitle = computed(() =>
  draft.index >= 0 ? t('vpn.editUser') : t('vpn.addUser'),
)

const deleteTarget = computed(() =>
  deleteIndex.value >= 0 ? config.value?.users[deleteIndex.value] : undefined,
)

async function load(quiet = false) {
  if (!quiet) loading.value = true
  try {
    config.value = unwrap(await getRouterApi().getVpnUsers())
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    if (!quiet) loading.value = false
  }
}

const refreshQuietly = () => void load(true)
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(
  refreshQuietly,
  refreshQuietly,
)

function openAdd() {
  draft.index = -1
  draft.type = config.value?.types[0] || 'all'
  draft.username = ''
  draft.password = ''
  draft.address = ''
  draft.routes = ''
  draft.comment = ''
  showPassword.value = false
  editorOpen.value = true
}

function openEdit(index: number) {
  const user = config.value?.users[index]
  if (!user) return
  draft.index = index
  draft.type = user.type
  draft.username = user.username
  draft.password = user.password
  draft.address = user.address
  draft.routes = user.routes
  draft.comment = user.comment
  showPassword.value = false
  editorOpen.value = true
}

function draftUser(): VpnUser {
  return {
    type: draft.type,
    username: draft.username,
    password: draft.password,
    address: draft.address.trim(),
    routes: draft.routes.trim(),
    comment: draft.comment,
  }
}

async function restoreActiveTask() {
  const api = getRouterApi()
  if (!api.getActiveConfigTask) return
  try {
    const active = unwrap(await api.getActiveConfigTask())
    if (active?.taskId && active.state === 'pending')
      await begin(asApplyHandle({ accepted: true, taskId: active.taskId, rollbackSec: active.remainingSec || 60, phase: active.phase }))
  } catch {
    // ignore
  }
}

async function persist(users: VpnUser[]) {
  if (!config.value) return
  saving.value = true
  try {
    const next = { ...config.value, users }
    const result = unwrap(await getRouterApi().updateVpnUsers(next))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    config.value = next
    editorOpen.value = false
    deleteIndex.value = -1
    notifySaved(result, 'vpn.userSaved')
    await load(true)
  } catch (e) {
    toast.error(formatApiError(e, t))
    await restoreActiveTask()
  } finally {
    saving.value = false
  }
}

async function saveDraft() {
  if (!config.value) return
  if (!draft.username.trim()) {
    toast.error(t('vpn.errUsername'))
    return
  }
  const users = config.value.users.map((user) => ({ ...user }))
  const next = draftUser()
  if (draft.index >= 0) users.splice(draft.index, 1, next)
  else users.push(next)
  await persist(users)
}

async function confirmDelete() {
  if (!config.value || deleteIndex.value < 0) return
  const users = config.value.users.filter((_, index) => index !== deleteIndex.value)
  await persist(users)
}

onMounted(async () => {
  await load()
  await restoreActiveTask()
})
</script>

<template>
  <div class="users-page">
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
    <UiCard v-else icon="vpn" :title="t('nav.vpnUsers')">
      <template #actions>
        <UiButton @click="openAdd">{{ t('vpn.addUser') }}</UiButton>
      </template>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('vpn.userType') }}</th>
              <th>{{ t('vpn.username') }}</th>
              <th>{{ t('vpn.password') }}</th>
              <th>{{ t('vpn.assignIp') }}</th>
              <th>{{ t('vpn.comment') }}</th>
              <th>{{ t('vpn.staticRoutes') }}</th>
              <th class="op">{{ t('common.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!config?.users.length">
              <td colspan="7" class="empty">{{ t('common.emptyUsers') }}</td>
            </tr>
            <tr v-for="(user, index) in config?.users" :key="`${user.username}-${index}`">
              <td>{{ user.type.toUpperCase() }}</td>
              <td>{{ user.username }}</td>
              <td class="pwd-cell">{{ user.password || '—' }}</td>
              <td>{{ user.address || t('vpn.auto') }}</td>
              <td>{{ user.comment || '—' }}</td>
              <td class="routes">{{ user.routes || '—' }}</td>
              <td class="op">
                <div class="op-actions">
                  <button
                    class="icon-action"
                    type="button"
                    :title="t('common.edit')"
                    :aria-label="t('common.edit')"
                    @click="openEdit(index)"
                  >
                    <UiIcon name="edit" :size="18" />
                  </button>
                  <button
                    class="icon-action unlock"
                    type="button"
                    :title="t('common.delete')"
                    :aria-label="t('common.delete')"
                    @click="deleteIndex = index"
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

    <UiModal
      :open="editorOpen"
      size="md"
      :title="editorTitle"
      :confirm-disabled="saving"
      :confirm-label="saving ? t('common.saving') : t('common.ok')"
      @close="editorOpen = false"
      @confirm="saveDraft"
    >
      <div class="user-form">
        <UiField :label="t('vpn.userType')">
          <UiSelect v-model="draft.type" :options="typeOptions" />
        </UiField>
        <UiField :label="t('vpn.username')">
          <input
            v-model="draft.username"
            maxlength="32"
            :disabled="draft.index >= 0"
            autocomplete="off"
          />
        </UiField>
        <UiField :label="t('vpn.password')">
          <div class="pass">
            <input
              v-model="draft.password"
              :type="showPassword ? 'text' : 'password'"
              maxlength="32"
              autocomplete="new-password"
            />
            <button
              class="pass-toggle"
              type="button"
              :aria-pressed="showPassword"
              :aria-label="showPassword ? t('login.hidePassword') : t('login.showPassword')"
              :title="showPassword ? t('login.hidePassword') : t('login.showPassword')"
              @click="showPassword = !showPassword"
            >
              <UiIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>
        <UiField :label="t('vpn.assignIp')" :hint="t('vpn.assignIpHint')">
          <input v-model="draft.address" :placeholder="t('vpn.auto')" />
        </UiField>
        <UiField :label="t('vpn.staticRoutes')" :hint="t('vpn.staticRoutesHint')">
          <input v-model="draft.routes" maxlength="128" />
        </UiField>
        <UiField :label="t('vpn.comment')">
          <input v-model="draft.comment" maxlength="16" />
        </UiField>
      </div>
    </UiModal>

    <UiModal
      :open="deleteIndex >= 0"
      size="sm"
      :title="t('vpn.deleteUserTitle')"
      danger
      :confirm-disabled="saving"
      :confirm-label="saving ? t('common.deleting') : t('common.delete')"
      @close="deleteIndex = -1"
      @confirm="confirmDelete"
    >
      <div class="delete-body">
        <p class="delete-name">
          {{ t('vpn.deleteUserName', { name: deleteTarget?.username || '—' }) }}
        </p>
        <p class="delete-hint">{{ t('vpn.deleteUserBody') }}</p>
      </div>
    </UiModal>
  </div>
</template>

<style scoped>
.users-page {
  width: 100%;
}

.users-page :deep(.head) {
  align-items: center;
}

@media (max-width: 640px) {
  .users-page :deep(.head) {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .users-page :deep(.titles) {
    min-width: 0;
    flex: 1;
  }

  .users-page :deep(.actions) {
    width: auto;
    flex-shrink: 0;
  }
}

.table td.empty {
  padding: 28px 12px;
  text-align: center;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}

.table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.table th,
.table td {
  padding: 12px 10px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: middle;
}

.table th {
  color: var(--color-muted);
  font-weight: 500;
  background: var(--color-table-head);
}

.table .op {
  width: 100px;
  text-align: center;
}

.pwd-cell {
  font-size: 12px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.routes {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.icon-action.unlock {
  color: var(--color-danger);
}

.user-form {
  display: grid;
  gap: 4px;
}

.user-form :deep(.field) {
  margin-bottom: 14px;
}

.user-form :deep(.label) {
  margin-bottom: 2px;
  color: var(--color-title);
  font-weight: 500;
}

.user-form :deep(.control input),
.user-form :deep(.control .ui-select) {
  width: 100%;
  max-width: none;
}

.user-form :deep(.control input) {
  background: var(--color-bg-muted);
  border-color: transparent;
  border-radius: 999px;
  height: 40px;
  padding: 0 16px;
}

.user-form :deep(.control input:focus) {
  background: var(--color-surface);
  border-color: var(--color-primary);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.user-form :deep(.control input:disabled) {
  color: var(--color-muted);
  cursor: not-allowed;
}

.user-form :deep(.control .ui-select-trigger) {
  width: 100%;
  min-height: 40px;
  border-radius: 999px;
  background: var(--color-bg-muted);
  border-color: transparent;
  padding: 4px 14px;
}

.user-form :deep(.control .ui-select.open .ui-select-trigger),
.user-form :deep(.control .ui-select-trigger:hover),
.user-form :deep(.control .ui-select-trigger:focus-visible) {
  background: var(--color-surface);
  border-color: var(--color-primary);
}

.user-form :deep(.hint) {
  margin-top: 6px;
}

.pass {
  position: relative;
  width: 100%;
}

.pass input {
  width: 100%;
  padding-right: 44px !important;
}

.pass-toggle {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-muted);
  cursor: pointer;
  padding: 0;
}

.pass-toggle:hover {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.delete-body {
  margin: 0;
  text-align: left;
  line-height: 1.5;
}

.delete-name {
  margin: 0 0 8px;
  color: var(--color-title);
  font-size: var(--fs-base);
  font-weight: 600;
  word-break: break-all;
}

.delete-hint {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}
</style>
