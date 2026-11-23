<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import NativeServiceNotice from '@/components/NativeServiceNotice.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { L2tpClientConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const form = reactive<L2tpClientConfig>({
  enabled: false,
  status: 0,
  address: '',
  server: '',
  username: '',
  password: '',
  ipsecKey: '',
  serverEnabled: false,
})

const isNative = import.meta.env.VITE_ROUTER_ADAPTER === 'device'
let loadedEnabled = false
const clientConnected = computed(() => isNative
  ? loadedEnabled && form.enabled && form.status === 1
  : form.status !== 0)
let timer: ReturnType<typeof setInterval> | undefined

const enabled = computed({
  get: () => form.enabled,
  set(value: boolean) {
    if (value && form.serverEnabled) {
      toast.error(t('vpn.l2tpServerModeConflict'))
      return
    }
    form.enabled = value
  },
})

function stopStatusPoll() {
  if (timer) clearInterval(timer)
  timer = undefined
}

function startStatusPoll() {
  stopStatusPoll()
  if (!loadedEnabled || !form.enabled) return
  timer = setInterval(() => void refreshStatus(), 6000)
}

async function refreshStatus() {
  try {
    const data = unwrap(await getRouterApi().getL2tpClient())
    form.status = data.status
    form.address = data.address
    form.serverEnabled = data.serverEnabled
    loadedEnabled = data.enabled
    if (!loadedEnabled || !form.enabled) stopStatusPoll()
  } catch {
    stopStatusPoll()
  }
}

async function load() {
  loading.value = true
  stopStatusPoll()
  try {
    const data = unwrap(await getRouterApi().getL2tpClient())
    loadedEnabled = data.enabled
    Object.assign(form, data)
    startStatusPoll()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateL2tpClient({ ...form }))
    notifySaved(result, 'vpn.l2tpClientApplied')
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

watch(
  () => form.enabled,
  () => startStatusPoll(),
)

onMounted(() => void load())
onUnmounted(stopStatusPoll)
</script>

<template>
  <div>
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <div class="settings-form">
        <NativeServiceNotice :available="form.serviceAvailable" :message="form.serviceMessage" />
        <UiFormRow :label="t('vpn.l2tpClientSettings')">
          <label class="switch">
            <input v-model="enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiFormRow>

        <template v-if="form.enabled">
          <UiFormRow :label="t('vpn.connectionStatus')">
            <div class="value">{{ clientConnected ? t('common.connected') : t('common.disconnected') }}</div>
          </UiFormRow>
          <UiFormRow :label="t('vpn.clientIp')">
            <div class="value">{{ form.address || '—' }}</div>
          </UiFormRow>

          <UiField layout="horizontal" :label="t('vpn.serverAddress')" :hint="t('vpn.serverHint63Required')">
            <input v-model="form.server" maxlength="63" autocomplete="off" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.username')" :hint="t('vpn.usernameHintRequired')">
            <input v-model="form.username" maxlength="32" autocomplete="off" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.password')" :hint="t('vpn.passwordHintRequired')">
            <input v-model="form.password" type="password" maxlength="32" autocomplete="new-password" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.psk')" :hint="t('vpn.pskHint')">
            <input v-model="form.ipsecKey" type="password" maxlength="63" autocomplete="new-password" />
          </UiField>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>
