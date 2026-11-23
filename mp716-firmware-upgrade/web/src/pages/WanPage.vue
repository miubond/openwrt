<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { WanConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { isIpv4 } from '@/utils/validate'

const { t } = useI18n()
const isNative = import.meta.env.VITE_ROUTER_ADAPTER === 'device'

const modeOptions = [
  { value: 'dhcp', label: 'DHCP' },
  { value: 'static', label: 'STATIC' },
  { value: 'pppoe', label: 'PPPOE' },
]

const mobileProtoOptions = [{ value: 'dhcp', label: 'DHCP' }]

const dialOptions = computed(() => [
  { value: 0, label: t('wan.dialAuto') },
  { value: 1, label: t('wan.dialManual') },
])

interface WanPageForm {
  mode: WanConfig['proto']
  dns: string[]
  ccMtu: number
  pppMtu: number
  macaddr: string
  hostname: string
  ac: string
  service: string
  wanMode: string
  defaultMac: string
  clientMac: string
  useApn: number
  apnName: string
  apnUser: string
  apnPassword: string
  authType: number
  static?: { ip: string; netmask: string; gateway: string }
  pppoe?: { username: string; password: string }
}

function wanConfigToForm(cfg: WanConfig): WanPageForm {
  return {
    mode: cfg.proto,
    dns: cfg.dns || [],
    ccMtu: cfg.mtu,
    pppMtu: cfg.pppMtu ?? 1492,
    macaddr: cfg.macaddr || '',
    hostname: cfg.hostname || '',
    ac: cfg.ac || '',
    service: cfg.service || '',
    wanMode: cfg.wanMode || 'wired',
    defaultMac: cfg.defaultMac || cfg.macaddr || '',
    clientMac: cfg.clientMac || '',
    useApn: cfg.useApn ?? 0,
    apnName: cfg.apnName || '',
    apnUser: cfg.apnUser || '',
    apnPassword: cfg.apnPassword || '',
    authType: cfg.authType ?? 0,
    static: {
      ip: cfg.ipv4 || '',
      netmask: cfg.netmask || '',
      gateway: cfg.gateway || '',
    },
    pppoe: { username: cfg.username || '', password: cfg.password || '' },
  }
}

function formToWanConfig(form: WanPageForm, dns: string[]): WanConfig {
  const base: WanConfig = {
    proto: form.mode,
    dns,
    mtu: form.ccMtu,
    pppMtu: form.pppMtu,
    macaddr: form.macaddr,
    hostname: form.hostname,
    ac: form.ac,
    service: form.service,
    wanMode: form.wanMode,
    useApn: form.useApn,
    apnName: form.apnName,
    apnUser: form.apnUser,
    apnPassword: form.apnPassword,
    authType: form.authType,
  }
  if (form.mode === 'static') {
    return {
      ...base,
      ipv4: form.static?.ip,
      netmask: form.static?.netmask,
      gateway: form.static?.gateway,
    }
  }
  if (form.mode === 'pppoe') {
    return {
      ...base,
      username: form.pppoe?.username,
      password: form.pppoe?.password,
    }
  }
  return base
}

const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const helpOpen = ref(false)
const form = reactive<WanPageForm>({
  mode: 'dhcp',
  dns: [],
  ccMtu: 1500,
  pppMtu: 1492,
  macaddr: '',
  hostname: '',
  ac: '',
  service: '',
  wanMode: 'wired',
  defaultMac: '',
  clientMac: '',
  useApn: 0,
  apnName: '',
  apnUser: '',
  apnPassword: '',
  authType: 0,
  static: { ip: '', netmask: '', gateway: '' },
  pppoe: { username: '', password: '' },
})
const dns1 = ref('')
const dns2 = ref('')
const errors = reactive<Record<string, string | null>>({})

const cloneMac = computed({
  get: () => {
    if (!form.clientMac || !form.macaddr) return false
    return form.macaddr.toUpperCase() === form.clientMac.toUpperCase()
  },
  set: (checked: boolean) => {
    if (checked) {
      if (!form.clientMac) {
        toast.error(t('wan.errClientMac'))
        return
      }
      form.macaddr = form.clientMac.toUpperCase()
      return
    }
    form.macaddr = (form.defaultMac || form.macaddr).toUpperCase()
  },
})

const useApnModel = computed({
  get: () => form.useApn,
  set: (v: string | number) => {
    form.useApn = Number(v)
  },
})

async function load() {
  loading.value = true
  try {
    const wanCfg = unwrap(await getRouterApi().getWanConfig())
    Object.assign(form, wanConfigToForm(wanCfg))
    if (!form.static) form.static = { ip: '', netmask: '', gateway: '' }
    if (!form.pppoe) form.pppoe = { username: '', password: '' }
    dns1.value = wanCfg.dns?.[0] || ''
    dns2.value = wanCfg.dns?.[1] || ''
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function onWanModeChange(mode: string) {
  form.wanMode = mode
  if (mode === 'mobile') form.mode = 'dhcp'
}

function validate(): boolean {
  errors.staticIp = null
  errors.netmask = null
  errors.gateway = null
  errors.dns1 = null
  errors.pppoeUser = null
  errors.mac = null
  if (form.wanMode === 'mobile') {
    if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(form.macaddr.trim())) {
      errors.mac = t('validation.macFormat')
    }
    if (form.useApn === 1 && !form.apnName.trim()) {
      toast.error(t('wan.errApnRequired'))
      return false
    }
    return !errors.mac
  }
  if (form.mode === 'static') {
    if (!isIpv4(form.static?.ip || '')) errors.staticIp = t('wan.errIpv4')
    if (!form.static?.netmask) errors.netmask = t('wan.errNetmaskRequired')
    if (!isIpv4(form.static?.gateway || '')) errors.gateway = t('wan.errGateway')
    if (!isIpv4(dns1.value || '')) errors.dns1 = t('wan.errDns1')
  }
  if (form.mode === 'pppoe' && !form.pppoe?.username) {
    errors.pppoeUser = t('wan.errPppoeUser')
  }
  if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(form.macaddr.trim())) {
    errors.mac = t('validation.macFormat')
  }
  return !Object.values(errors).some(Boolean)
}

async function save() {
  if (!validate()) return
  saving.value = true
  try {
    const dns =
      form.mode === 'static'
        ? [dns1.value, dns2.value].map((s) => s.trim()).filter(Boolean)
        : form.dns
    form.dns = dns
    const result = unwrap(await getRouterApi().updateWanConfig(formToWanConfig(form, dns)))
    notifySaved(result, 'wan.configSubmitted')
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div>
    <p class="page-desc">{{ t('wan.desc') }}</p>
    <button class="help-link" type="button" @click="helpOpen = !helpOpen">{{ t('wan.help') }}</button>
    <p v-if="helpOpen" class="help-box">{{ t('wan.helpBody') }}</p>

    <ApplyBanner
      v-if="pending"
      :remaining="remaining" :phase="pending?.phase" :message="pending?.message"
      :applying="applying"
      @confirm="confirm"
      @cancel="cancel"
    />
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <div class="settings-form wan-form">
        <UiField layout="horizontal" :label="t('wan.networkPolicy')">
          <div class="radios">
            <label class="radio">
              <input
                type="radio"
                name="wan-mode"
                value="wired"
                :checked="form.wanMode === 'wired'"
                @change="onWanModeChange('wired')"
              />
              <span>{{ t('dashboard.netType.wired') }}</span>
            </label>
            <label class="radio">
              <input
                type="radio"
                name="wan-mode"
                value="mobile"
                :disabled="isNative"
                :checked="form.wanMode === 'mobile'"
                @change="onWanModeChange('mobile')"
              />
              <span>{{ t('dashboard.netType.mobile') }}<small v-if="isNative"> — {{ t('wan.nativeWiredOnly') }}</small></span>
            </label>
          </div>
        </UiField>

        <template v-if="form.wanMode === 'mobile'">
          <UiField layout="horizontal" :label="t('wan.dialMode')">
            <UiSelect v-model="useApnModel" :options="dialOptions" />
          </UiField>
          <UiField layout="horizontal" :label="t('wan.accessMode')">
            <UiSelect v-model="form.mode" :options="mobileProtoOptions" disabled />
          </UiField>
          <UiField layout="horizontal" :label="t('common.hostname')">
            <input v-model="form.hostname" maxlength="32" />
          </UiField>
          <UiField layout="horizontal" label="MTU">
            <input v-model.number="form.ccMtu" type="number" min="576" max="1500" />
          </UiField>
          <UiField layout="horizontal" :label="t('common.mac')" :error="errors.mac">
            <input v-model="form.macaddr" />
          </UiField>
          <div class="clone-row">
            <span class="clone-spacer" />
            <label class="check">
              <input v-model="cloneMac" type="checkbox" />
              <span>{{ t('wan.cloneMac') }}</span>
            </label>
          </div>
          <template v-if="form.useApn === 1">
            <UiField layout="horizontal" :label="t('wan.apnName')">
              <input v-model="form.apnName" maxlength="64" autocomplete="off" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.apnUser')">
              <input v-model="form.apnUser" maxlength="64" autocomplete="off" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.apnPassword')">
              <input v-model="form.apnPassword" type="password" maxlength="64" autocomplete="new-password" />
            </UiField>
          </template>
        </template>

        <template v-else>
          <UiField layout="horizontal" :label="t('wan.accessMode')">
            <UiSelect v-model="form.mode" :options="modeOptions" />
          </UiField>

          <template v-if="form.mode === 'dhcp'">
            <UiField layout="horizontal" :label="t('common.hostname')">
              <input v-model="form.hostname" maxlength="32" />
            </UiField>
          </template>

          <template v-if="form.mode === 'static'">
            <UiField layout="horizontal" :label="t('common.ip')" :error="errors.staticIp">
              <input v-model="form.static!.ip" />
            </UiField>
            <UiField layout="horizontal" :label="t('dashboard.netmask')" :error="errors.netmask">
              <input v-model="form.static!.netmask" />
            </UiField>
            <UiField layout="horizontal" :label="t('status.defaultGateway')" :error="errors.gateway">
              <input v-model="form.static!.gateway" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.dns1')" :error="errors.dns1">
              <input v-model="dns1" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.dns2')">
              <input v-model="dns2" />
            </UiField>
          </template>

          <template v-if="form.mode === 'pppoe'">
            <UiField layout="horizontal" :label="t('wan.pppoeUser')" :error="errors.pppoeUser">
              <input v-model="form.pppoe!.username" autocomplete="off" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.pppoePassword')">
              <input v-model="form.pppoe!.password" type="password" autocomplete="new-password" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.acName')">
              <input v-model="form.ac" />
            </UiField>
            <UiField layout="horizontal" :label="t('wan.serviceName')">
              <input v-model="form.service" />
            </UiField>
          </template>

          <UiField layout="horizontal" v-if="form.mode === 'pppoe'" label="MTU">
            <input v-model.number="form.pppMtu" type="number" min="576" max="1500" />
          </UiField>
          <UiField layout="horizontal" v-else label="MTU">
            <input v-model.number="form.ccMtu" type="number" min="576" max="1500" />
          </UiField>

          <UiField layout="horizontal" :label="t('common.mac')" :error="errors.mac">
            <input v-model="form.macaddr" />
          </UiField>

          <div class="clone-row">
            <span class="clone-spacer" />
            <label class="check">
              <input v-model="cloneMac" type="checkbox" />
              <span>{{ t('wan.cloneMac') }}</span>
            </label>
          </div>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.page-desc {
  margin: 0 0 8px;
  color: var(--color-muted);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
}
.help-link {
  border: 0;
  background: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
  margin: 0 0 16px;
  font-size: var(--fs-base);
}
.help-box {
  margin: -8px 0 16px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--color-primary-soft);
  color: var(--color-text);
  font-size: var(--fs-sm, 13px);
  line-height: var(--lh-base);
}
.hint {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: 13px;
}
.wan-form {
  max-width: 560px;
}
.radios {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  min-height: 36px;
  align-items: center;
}
.radio,
.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
  font-size: var(--fs-base);
  cursor: pointer;
}
.radio input,
.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--color-primary);
}
.clone-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  column-gap: 20px;
  margin: -6px 0 18px;
}
.clone-spacer {
  display: none;
}
</style>
