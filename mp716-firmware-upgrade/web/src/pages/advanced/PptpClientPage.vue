<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { PptpClientConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)

const mppeOptions = computed(() => [
  { value: 0, label: t('vpn.mppeRequired') },
  { value: 1, label: t('vpn.mppeOptional') },
  { value: 2, label: t('vpn.mppeNone') },
])

const routeTypeOptions = computed(() => [
  { value: 0, label: t('vpn.routeManual') },
  { value: 1, label: t('vpn.routeAuto') },
])

const form = reactive<PptpClientConfig>({
  enabled: false,
  status: 0,
  address: '',
  server: '',
  username: '',
  password: '',
  mppe: 0,
  routeType: 0,
  routes: [],
})

let loadedEnabled = false
let timer: ReturnType<typeof setInterval> | undefined

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
    const data = unwrap(await getRouterApi().getPptpClient())
    form.status = data.status
    form.address = data.address
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
    const data = unwrap(await getRouterApi().getPptpClient())
    loadedEnabled = data.enabled
    Object.assign(form, data)
    startStatusPoll()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function addRoute() {
  form.routes.push({ target: '', netmask: '' })
}

function removeRoute(index: number) {
  form.routes.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updatePptpClient({ ...form, routes: form.routes.map((route) => ({ ...route })) }))
    toast.success(t('vpn.pptpClientApplied'))
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
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <div class="settings-form">
        <UiFormRow :label="t('vpn.pptpClientSettings')">
          <label class="switch">
            <input v-model="form.enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiFormRow>

        <template v-if="form.enabled">
          <UiFormRow :label="t('vpn.connectionStatus')">
            <div class="value">{{ form.status === 0 ? t('vpn.connFailed') : t('vpn.connSuccess') }}</div>
          </UiFormRow>
          <UiFormRow :label="t('vpn.clientIp')">
            <div class="value">{{ form.address || '—' }}</div>
          </UiFormRow>

          <UiField layout="horizontal" :label="t('vpn.serverAddress')" :hint="t('vpn.serverHint63')">
            <input v-model="form.server" maxlength="63" autocomplete="off" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.username')" :hint="t('vpn.usernameHint')">
            <input v-model="form.username" maxlength="32" autocomplete="off" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.password')" :hint="t('vpn.passwordHint')">
            <input v-model="form.password" type="password" maxlength="32" autocomplete="new-password" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.mppeEncryption')">
            <UiSelect v-model="form.mppe" :options="mppeOptions" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.routeMode')">
            <UiSelect v-model="form.routeType" :options="routeTypeOptions" />
          </UiField>

          <div v-if="form.routeType === 0" class="routes">
            <div class="routes-head">
              <h4>{{ t('vpn.staticRouteTitle') }}</h4>
              <UiButton variant="secondary" @click="addRoute">{{ t('vpn.addRoute') }}</UiButton>
            </div>
            <div v-if="!form.routes.length" class="empty">{{ t('vpn.emptyStaticRoutes') }}</div>
            <div v-for="(route, index) in form.routes" :key="index" class="route-row">
              <UiField layout="horizontal" :label="t('common.ip')">
                <input v-model="route.target" placeholder="192.168.8.0" />
              </UiField>
              <UiField layout="horizontal" :label="t('vpn.netmask')">
                <input v-model="route.netmask" placeholder="255.255.255.0" />
              </UiField>
              <UiButton variant="secondary" @click="removeRoute(index)">{{ t('common.delete') }}</UiButton>
            </div>
          </div>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.routes {
  margin: 8px 0 4px;
  max-width: 576px;
}
.routes-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  padding-left: 140px;
}
.routes-head h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-title);
}
.empty {
  color: var(--color-muted);
  padding: 4px 0 12px 140px;
  font-size: 13px;
}
.route-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 8px;
}
@media (max-width: 640px) {
  .routes-head,
  .empty {
    padding-left: 0;
  }
  .route-row {
    grid-template-columns: 1fr;
  }
}
</style>
