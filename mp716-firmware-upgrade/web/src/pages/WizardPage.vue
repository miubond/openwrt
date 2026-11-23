<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiCard from '@/components/UiCard.vue'
import UiSelect from '@/components/UiSelect.vue'
import LoadingState from '@/components/LoadingState.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useAuthStore } from '@/stores/auth'
import type { QuickSettingWan, QuickSettingWifi } from '@/api'
import { useToastStore } from '@/stores/toast'
import { isIpv4 } from '@/utils/validate'

const router = useRouter()
const { t } = useI18n()
const isNative = import.meta.env.VITE_ROUTER_ADAPTER === 'device'
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm(() => void load())
async function confirmWizard() { if (await confirm() === 'confirmed') await goHome() }
const toast = useToastStore()
const auth = useAuthStore()
const loading = ref(true)
const saving = ref(false)
const step = ref<1 | 2>(1)
const progressSec = ref(0)
const progressOpen = ref(false)
const reconnectIp = ref('')

const wan = reactive<QuickSettingWan>({
  wanType: 'wired',
  proto: 'dhcp',
  hostName: '',
  dns: ['', ''],
  ipAddr: '',
  subnetMask: '255.255.255.0',
  gateway: '',
  username: '',
  password: '',
  ac: '',
  service: '',
  useApn: 0,
  apnName: '',
  apnUser: '',
  apnPassword: '',
  authType: 0,
})

const wanTypeOptions = computed(() => [
  { value: 'wired', label: t('wizard.wired') },
  ...(!isNative ? [{ value: 'mobile', label: t('wizard.cellular') }] : []),
])

const useApnOptions = computed(() => [
  { value: 0, label: t('wan.dialAuto') },
  { value: 1, label: t('wan.dialManual') },
])

const wanProtoOptions = computed(() => [
  { value: 'dhcp', label: 'DHCP' },
  { value: 'static', label: t('wizard.protoStatic') },
  { value: 'pppoe', label: 'PPPoE' },
])

const encryOptions = computed(() => [
  { value: 0, label: t('wizard.encNone') },
  { value: 1, label: t('wizard.encOn') },
])

const useApnModel = computed({
  get: () => wan.useApn ?? 0,
  set: (value: string | number) => {
    wan.useApn = Number(value)
  },
})

const wifi = reactive<QuickSettingWifi>({
  ssid2g: '',
  encry2g: 1,
  passphrase2g: '',
})

async function goHome() {
  try {
    unwrap(await getRouterApi().completeWizardFirstBoot())
  } catch (e) {
    if (isNative) {
      toast.error(formatApiError(e, t))
      return
    }
    /* Keep the original factory skip behavior. */
  }
  auth.markWizardComplete()
  await router.replace('/')
}

async function load() {
  loading.value = true
  try {
    const data = unwrap(await getRouterApi().getQuickSetting())
    if (data.firstBoot === 0) {
      await router.replace('/')
      return
    }
    Object.assign(wan, data.wan)
    if (wan.dns.length < 2) wan.dns = [...wan.dns, '', ''].slice(0, 2)
    Object.assign(wifi, data.wifi)
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function validateStep1(): boolean {
  if (wan.wanType === 'mobile') {
    if (wan.useApn === 1 && !wan.apnName?.trim()) {
      toast.error(t('wizard.errApnRequired'))
      return false
    }
    return true
  }
  if (wan.proto === 'dhcp') return true
  if (wan.proto === 'static') {
    if (!isIpv4(wan.ipAddr || '') || !isIpv4(wan.gateway || '')) {
      toast.error(t('wizard.errIpGateway'))
      return false
    }
    const d0 = wan.dns[0]?.trim()
    const d1 = wan.dns[1]?.trim()
    if (d0 && d1 && d0 === d1) {
      toast.error(t('wizard.errDnsDup'))
      return false
    }
    return true
  }
  if (!wan.username?.trim() || !wan.password?.trim()) {
    toast.error(t('wizard.errPppoe'))
    return false
  }
  return true
}

function nextStep() {
  if (!validateStep1()) return
  step.value = 2
}

async function finish() {
  if (!wifi.ssid2g.trim()) {
    toast.error(t('wizard.errSsid'))
    return
  }
  if (wifi.encry2g !== 0 && (wifi.passphrase2g || '').length < 8) {
    toast.error(t('wizard.errWifiPassword'))
    return
  }
  saving.value = true
  try {
    const dns = wan.dns.map((s) => s.trim()).filter(Boolean)
    const result = unwrap(
      await getRouterApi().applyQuickSetting({ ...wan, dns }, { ...wifi }),
    )
    if (isNative && result.taskId && result.rollbackSec) {
      await begin({ applyId: result.taskId, timeoutSec: result.rollbackSec, phase: result.phase })
      return
    }
    if (result.progressSec > 0) {
      progressSec.value = result.progressSec
      progressOpen.value = true
      reconnectIp.value = result.reconnectIp
      window.setTimeout(() => void onProgressDone(result.reconnect && !!result.reconnectIp), result.progressSec * 1000)
    } else {
      await goHome()
    }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

async function onProgressDone(needHint: boolean) {
  progressOpen.value = false
  if (needHint && reconnectIp.value) {
    toast.info(t('wizard.reconnectToast', { ip: reconnectIp.value }))
  }
  await goHome()
}

onMounted(() => void load())
</script>

<template>
  <div class="wizard-page">
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirmWizard" @cancel="cancel" />
    <div class="wizard-head">
      <h1>{{ t('wizard.title') }}</h1>
      <p class="hint">{{ t('wizard.hint') }}</p>
    </div>

    <LoadingState v-if="loading" />

    <UiCard v-else class="wizard-card">
      <template v-if="step === 1">
        <h2 class="section">{{ t('wizard.networkSection') }}</h2>
        <UiField :label="t('wan.accessMode')">
          <UiSelect v-model="wan.wanType" :options="wanTypeOptions" />
          <small v-if="isNative">{{ t('wan.nativeWiredOnly') }}</small>
        </UiField>

        <template v-if="wan.wanType === 'mobile'">
          <UiField :label="t('wizard.dial4g')">
            <UiSelect v-model="useApnModel" :options="useApnOptions" />
          </UiField>
          <template v-if="wan.useApn === 1">
            <UiField :label="t('wan.apnName')"><input v-model="wan.apnName" /></UiField>
            <UiField :label="t('wan.apnUser')"><input v-model="wan.apnUser" /></UiField>
            <UiField :label="t('wan.apnPassword')"><input v-model="wan.apnPassword" type="password" /></UiField>
          </template>
        </template>

        <template v-else>
          <UiField :label="t('wizard.protoAccess')">
            <UiSelect v-model="wan.proto" :options="wanProtoOptions" />
          </UiField>
          <UiField v-if="wan.proto === 'dhcp'" :label="t('common.hostname')">
            <input v-model="wan.hostName" maxlength="32" />
          </UiField>
          <template v-if="wan.proto === 'static'">
            <div class="grid-2">
              <UiField :label="t('common.ip')"><input v-model="wan.ipAddr" /></UiField>
              <UiField :label="t('dashboard.netmask')"><input v-model="wan.subnetMask" /></UiField>
              <UiField :label="t('dashboard.gateway')"><input v-model="wan.gateway" /></UiField>
              <UiField :label="t('wan.dns1')"><input v-model="wan.dns[0]" /></UiField>
              <UiField :label="t('wan.dns2')"><input v-model="wan.dns[1]" /></UiField>
            </div>
          </template>
          <template v-if="wan.proto === 'pppoe'">
            <UiField :label="t('wan.pppoeUser')"><input v-model="wan.username" autocomplete="off" /></UiField>
            <UiField :label="t('wan.pppoePassword')">
              <input v-model="wan.password" type="password" autocomplete="new-password" />
            </UiField>
            <UiField :label="t('wan.acName')"><input v-model="wan.ac" /></UiField>
            <UiField :label="t('wan.serviceName')"><input v-model="wan.service" /></UiField>
          </template>
        </template>

        <div class="actions">
          <UiButton variant="secondary" @click="goHome">{{ t('wizard.skip') }}</UiButton>
          <UiButton @click="nextStep">{{ t('wizard.next') }}</UiButton>
        </div>
      </template>

      <template v-else>
        <h2 class="section">{{ t('wizard.wifiSection') }}</h2>
        <UiField :label="t('wifiBasic.ssid')"><input v-model="wifi.ssid2g" maxlength="32" /></UiField>
        <UiField :label="t('wizard.encryption')">
          <UiSelect v-model="wifi.encry2g" :options="encryOptions" />
        </UiField>
        <UiField v-if="wifi.encry2g !== 0" :label="t('wifiBasic.password')">
          <input v-model="wifi.passphrase2g" type="password" maxlength="63" />
        </UiField>
        <div class="actions">
          <UiButton variant="secondary" @click="goHome">{{ t('wizard.skip') }}</UiButton>
          <UiButton variant="secondary" @click="step = 1">{{ t('wizard.prev') }}</UiButton>
          <UiButton class="wizard-finish" :disabled="saving" @click="finish">
            {{ saving ? t('common.applying') : t('wizard.finish') }}
          </UiButton>
        </div>
      </template>
    </UiCard>

    <div v-if="progressOpen" class="progress-mask" role="alertdialog" aria-live="polite">
      <div class="progress-box">
        <p>{{ t('wizard.progressApplying') }}</p>
        <p v-if="progressSec">{{ t('wizard.progressAbout', { n: progressSec }) }}</p>
        <UiButton variant="secondary" @click="onProgressDone(!!reconnectIp)">{{ t('wizard.goHome') }}</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wizard-page {
  min-height: 100vh;
  padding: 2rem 1rem 3rem;
  background: var(--color-bg);
}
.wizard-head {
  max-width: 640px;
  margin: 0 auto 1.25rem;
}
.wizard-head h1 {
  margin: 0 0 0.35rem;
  font-size: var(--fs-xl);
}
.hint {
  margin: 0;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}
.wizard-card {
  max-width: 640px;
  margin: 0 auto;
}
.section {
  margin: 0 0 1rem;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 1.25rem;
}
.wizard-finish {
  min-width: 180px;
  border-radius: 999px;
}
.progress-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.45);
}
.progress-box {
  max-width: 360px;
  padding: 1.25rem 1.5rem;
  border-radius: var(--radius-md);
  background: var(--color-panel);
  text-align: center;
}
.progress-box p {
  margin: 0 0 0.75rem;
}
</style>
