<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import UiIcon from '@/components/UiIcon.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import { formToWifiConfig, wifiConfigToForm, type WifiBasicForm } from '@/api/wifi-map'
import type { WifiSecondaryConfig } from '@/api/types'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const savingSecondary = ref(false)
const showPassword = ref(false)
const showSecondaryPassword = ref(false)
const secondarySupported = ref(false)
const secondaryForm = reactive({
  enabled: false,
  ssid: '',
  password: '',
  hidden: false,
  isolate: true,
})

const form = reactive<WifiBasicForm>({
  enabled: true,
  ssid: '',
  password: '',
  encryption: 'wpapskwpa2psk',
  cipher: 'aes',
  channel: 6,
  htmode: 'AUTO',
  mode: '11bgn',
  txpowerPercent: 100,
  maxClients: 32,
  isolate: false,
  hidden: false,
  macfilter: 'disable',
  maclist: [],
})

const enabledSel = computed({
  get: () => (form.enabled ? '1' : '0'),
  set: (v: string | number) => {
    form.enabled = String(v) === '1'
  },
})

const isolateSel = computed({
  get: () => (form.isolate ? '1' : '0'),
  set: (v: string | number) => {
    form.isolate = String(v) === '1'
  },
})

const channelSel = computed({
  get: () => form.channel,
  set: (v: string | number) => {
    form.channel = v === 'auto' ? 'auto' : Number(v)
  },
})

const txpowerSel = computed({
  get: () => form.txpowerPercent,
  set: (v: string | number) => {
    form.txpowerPercent = Number(v) as WifiBasicForm['txpowerPercent']
  },
})

const secondaryEnabledSel = computed({
  get: () => (secondaryForm.enabled ? '1' : '0'),
  set: (v: string | number) => {
    secondaryForm.enabled = String(v) === '1'
  },
})

const secondaryIsolateSel = computed({
  get: () => (secondaryForm.isolate ? '1' : '0'),
  set: (v: string | number) => {
    secondaryForm.isolate = String(v) === '1'
  },
})

const enabledOptions = computed(() => [
  { value: '1', label: t('common.enabled') },
  { value: '0', label: t('common.disabled') },
])

const modeOptions = [
  { value: '11b', label: '11B' },
  { value: '11g', label: '11G' },
  { value: '11n', label: '11N' },
  { value: '11bg', label: '11BG' },
  { value: '11bgn', label: '11BGN' },
]

const htmodeOptions = [
  { value: 'AUTO', label: 'AUTO' },
  { value: 'HT20', label: '20M' },
]

const isolateOptions = computed(() => [
  { value: '0', label: t('common.disabled') },
  { value: '1', label: t('common.enabled') },
])

const channelOptions = computed(() => [
  { value: 'auto', label: t('wifiBasic.channelAuto') },
  ...Array.from({ length: 13 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
])

const txpowerOptions = [
  { value: 100, label: '100%' },
  { value: 75, label: '75%' },
  { value: 50, label: '50%' },
  { value: 25, label: '25%' },
  { value: 12, label: '12.5%' },
  { value: 0, label: '0%' },
]

const encryptionOptions = computed(() => [
  { value: 'wpapsk', label: 'WPAPSK' },
  { value: 'wpa2psk', label: 'WPA2PSK' },
  { value: 'wpapskwpa2psk', label: 'WPAPSKWPA2PSK' },
  { value: 'none', label: t('common.disabled') },
])

async function load() {
  loading.value = true
  try {
    const cfg = unwrap(await getRouterApi().getWifiConfig())
    Object.assign(form, wifiConfigToForm(cfg))
    const sec = cfg.secondary
    secondarySupported.value = sec?.supported === true
    if (sec && secondarySupported.value) {
      secondaryForm.enabled = sec.enabled
      secondaryForm.ssid = sec.ssid
      secondaryForm.password = sec.password ?? ''
      secondaryForm.hidden = sec.hidden
      secondaryForm.isolate = sec.isolate
    }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (form.enabled && !form.ssid.trim()) {
    toast.error(t('wifiBasic.errSsid'))
    return
  }
  if (form.maxClients < 1 || form.maxClients > 32) {
    toast.error(t('wifiBasic.errMaxClients'))
    return
  }
  if (form.enabled && form.encryption !== 'none' && form.password.length < 8) {
    toast.error(t('wifiBasic.errPassword'))
    return
  }
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateWifiConfig(formToWifiConfig(form)))
    toast.success(t('wifiBasic.saved'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

async function saveSecondary() {
  if (!secondarySupported.value) return
  if (secondaryForm.enabled && !secondaryForm.ssid.trim()) {
    toast.error(t('wifiBasic.errSecondarySsid'))
    return
  }
  if (
    secondaryForm.enabled &&
    secondaryForm.password !== '********' &&
    secondaryForm.password.length > 0 &&
    secondaryForm.password.length < 8
  ) {
    toast.error(t('wifiBasic.errPassword'))
    return
  }
  savingSecondary.value = true
  try {
    const payload: WifiSecondaryConfig = {
      supported: true,
      enabled: secondaryForm.enabled,
      ssid: secondaryForm.ssid.trim(),
      hidden: secondaryForm.hidden,
      isolate: secondaryForm.isolate,
    }
    if (secondaryForm.password && secondaryForm.password !== '********') {
      payload.password = secondaryForm.password
    }
    const result = unwrap(await getRouterApi().updateWifiSecondaryConfig(payload))
    toast.success(t('wifiBasic.secondarySaved'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    savingSecondary.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('wifiBasic.title')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('wifiBasic.enabled')">
          <UiSelect v-model="enabledSel" :options="enabledOptions" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.ssid')">
          <input v-model="form.ssid" maxlength="32" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.maxClients')" :hint="t('wifiBasic.maxClientsHint')">
          <input v-model.number="form.maxClients" type="number" min="1" max="32" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.hidden')">
          <label class="check">
            <input v-model="form.hidden" type="checkbox" />
            <span>{{ t('wifiBasic.hiddenHint') }}</span>
          </label>
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.mode')">
          <UiSelect v-model="form.mode" :options="modeOptions" />
        </UiField>

        <UiField
          v-if="form.mode === '11n' || form.mode === '11bgn'"
          layout="horizontal"
          :label="t('wifiBasic.bandwidth')"
        >
          <UiSelect v-model="form.htmode" :options="htmodeOptions" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.isolate')">
          <UiSelect v-model="isolateSel" :options="isolateOptions" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.channel')">
          <UiSelect v-model="channelSel" :options="channelOptions" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.txpower')">
          <UiSelect v-model="txpowerSel" :options="txpowerOptions" />
        </UiField>

        <UiField layout="horizontal" :label="t('wifiBasic.encryption')">
          <UiSelect v-model="form.encryption" :options="encryptionOptions" />
        </UiField>

        <UiField
          v-if="form.encryption !== 'none' && form.encryption !== 'sae'"
          layout="horizontal"
          :label="t('wifiBasic.cipher')"
        >
          <div class="radios">
            <label class="radio">
              <input v-model="form.cipher" type="radio" value="tkip" />
              <span>TKIP</span>
            </label>
            <label class="radio">
              <input v-model="form.cipher" type="radio" value="aes" />
              <span>AES</span>
            </label>
            <label class="radio">
              <input v-model="form.cipher" type="radio" value="tkipaes" />
              <span>TKIPAES</span>
            </label>
          </div>
        </UiField>

        <UiField v-if="form.encryption !== 'none'" layout="horizontal" :label="t('wifiBasic.password')">
          <div class="pass">
            <input
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
            />
            <button
              class="pass-toggle"
              type="button"
              :aria-label="showPassword ? t('login.hidePassword') : t('login.showPassword')"
              @click="showPassword = !showPassword"
            >
              <UiIcon :name="showPassword ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>

        <FormActions
          :loading="saving"
          :label="t('wifiBasic.save')"
          :loading-label="t('wifiBasic.saving')"
          @apply="save"
        />
      </div>
    </UiCard>

    <UiCard v-if="!loading && secondarySupported" :title="t('wifiBasic.secondaryTitle')" class="secondary-card">
      <p class="secondary-hint">{{ t('wifiBasic.secondaryHint') }}</p>
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('wifiBasic.enabled')">
          <UiSelect v-model="secondaryEnabledSel" :options="enabledOptions" />
        </UiField>
        <UiField layout="horizontal" :label="t('wifiBasic.ssid')">
          <input v-model="secondaryForm.ssid" maxlength="32" :disabled="!secondaryForm.enabled" />
        </UiField>
        <UiField layout="horizontal" :label="t('wifiBasic.hidden')">
          <label class="check">
            <input v-model="secondaryForm.hidden" type="checkbox" :disabled="!secondaryForm.enabled" />
            <span>{{ t('wifiBasic.hiddenHint') }}</span>
          </label>
        </UiField>
        <UiField layout="horizontal" :label="t('wifiBasic.isolate')">
          <UiSelect v-model="secondaryIsolateSel" :options="isolateOptions" :disabled="!secondaryForm.enabled" />
        </UiField>
        <UiField
          v-if="secondaryForm.enabled"
          layout="horizontal"
          :label="t('wifiBasic.password')"
        >
          <div class="pass">
            <input
              v-model="secondaryForm.password"
              :type="showSecondaryPassword ? 'text' : 'password'"
              autocomplete="new-password"
            />
            <button
              class="pass-toggle"
              type="button"
              :aria-label="showSecondaryPassword ? t('login.hidePassword') : t('login.showPassword')"
              @click="showSecondaryPassword = !showSecondaryPassword"
            >
              <UiIcon :name="showSecondaryPassword ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>
        <FormActions
          :loading="savingSecondary"
          :label="t('wifiBasic.secondarySave')"
          :loading-label="t('wifiBasic.saving')"
          @apply="saveSecondary"
        />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  color: var(--color-text);
  font-size: var(--fs-base);
  cursor: pointer;
}

.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
}

.radios {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  min-height: 36px;
  align-items: center;
}

.radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--color-title);
  font-size: var(--fs-base);
}

.radio input {
  accent-color: var(--color-primary);
}

.pass {
  position: relative;
  width: 100%;
}

.pass input {
  width: 100%;
  padding-right: 40px;
}

.pass-toggle {
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
}

.secondary-card {
  margin-top: 16px;
}

.secondary-hint {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}

</style>
