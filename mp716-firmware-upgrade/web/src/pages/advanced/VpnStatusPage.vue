<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiModal from '@/components/UiModal.vue'
import LoadingState from '@/components/LoadingState.vue'
import { ApiCallError, formatApiError, getRouterApi, unwrap } from '@/api'
import type { VpnOnlineUser } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const users = ref<VpnOnlineUser[]>([])
const disconnectPid = ref('')
const disconnecting = ref(false)
const POLL_MS = import.meta.env.VITE_ROUTER_ADAPTER === 'device' ? 15_000 : 5000
let timer: ReturnType<typeof setInterval> | undefined

async function load(quiet = false) {
  if (disconnecting.value) return
  if (!quiet) loading.value = true
  try {
    const current = unwrap(await getRouterApi().getVpnStatus())
    if (!disconnecting.value) users.value = current
  } catch (e) {
    if (!quiet) toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function confirmDisconnect() {
  const pid = disconnectPid.value
  disconnectPid.value = ''
  if (!pid || disconnecting.value) return
  disconnecting.value = true
  try {
    const api = getRouterApi()
    const result = unwrap(await api.disconnectVpnUser(pid))
    if (result?.disconnected) {
      users.value = users.value.filter(user => user.pid !== pid)
    } else {
      users.value = unwrap(await api.getVpnStatus())
      if (users.value.some(user => user.pid === pid)) {
        toast.warning(t('vpn.disconnectUnconfirmed'))
        return
      }
    }
    toast.success(t('vpn.userDisconnected'))
  } catch (e) {
    if (e instanceof ApiCallError && e.code === 'TIMEOUT') toast.warning(t('vpn.disconnectUnconfirmed'))
    else toast.error(formatApiError(e, t))
  } finally {
    disconnecting.value = false
  }
}

onMounted(() => {
  void load()
  timer = setInterval(() => void load(true), POLL_MS)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <p v-if="!users.length" class="empty">{{ t('vpn.emptyOnlineUsers') }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>{{ t('vpn.account') }}</th>
            <th>{{ t('vpn.type') }}</th>
            <th>{{ t('vpn.dialIp') }}</th>
            <th>{{ t('vpn.assignIp') }}</th>
            <th>{{ t('vpn.joinedAt') }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.pid || user.username">
            <td>{{ user.username || '—' }}</td>
            <td>{{ user.type || '—' }}</td>
            <td>{{ user.dialIp || '—' }}</td>
            <td>{{ user.assignIp || '—' }}</td>
            <td>{{ user.joinedAt || '—' }}</td>
            <td class="actions">
              <button type="button" :disabled="disconnecting" @click="disconnectPid = user.pid">{{ t('vpn.disconnect') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </UiCard>
    <UiModal
      :open="!!disconnectPid"
      :title="t('vpn.disconnectUserTitle')"
      danger
      @close="disconnectPid = ''"
      @confirm="confirmDisconnect"
    >
      <p>{{ t('vpn.disconnectUserBody') }}</p>
      <template #confirm-label>{{ t('vpn.disconnect') }}</template>
    </UiModal>
  </div>
</template>

<style scoped>
.empty {
  margin: 0;
  color: var(--color-muted);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th,
.table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}
.actions button {
  border: 0;
  background: transparent;
  color: var(--color-danger, #b42318);
  cursor: pointer;
  padding: 0;
}
</style>
