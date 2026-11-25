<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { VpnServerConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const props = defineProps<{ kind: 'pptp' | 'l2tp' }>()

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const showAdvanced = ref(true)

const mppeOptions = computed(() => [
  { value: 0, label: t('vpn.mppeRequired') },
  { value: 1, label: t('vpn.mppeOptional') },
  { value: 2, label: t('vpn.mppeNone') },
])

const ipsecOptions = computed(() => [
  { value: '0', label: t('common.off') },
  { value: '1', label: t('common.on') },
])

const serverSettingLabel = computed(() =>
  props.kind === 'pptp' ? t('vpn.pptpServerSettings') : t('vpn.l2tpServerSettings'),
)

const mppeModel = computed({
  get: () => form.mppe ?? 0,
  set: (value: string | number) => {
    form.mppe = Number(value)
  },
})

const ipsecSel = computed({
  get: () => (form.ipsecEnabled ? '1' : '0'),
  set: (value: string | number) => {
    form.ipsecEnabled = String(value) === '1'
  },
})

const form = reactive<VpnServerConfig>({
  enabled: false,
  startIp: '',
  endIp: '',
  server: '',
  mppe: 0,
  ipsecEnabled: false,
  ipsecKey: '',
  dnsEnabled: false,
  primaryDns: '',
  secondaryDns: '',
  mtu: 1400,
  mru: 1400,
})

async function load() {
  loading.value = true
  try {
    const api = getRouterApi()
    const data = unwrap(props.kind === 'pptp' ? await api.getPptpServer() : await api.getL2tpServer())
    Object.assign(form, data)
    showAdvanced.value =
      form.dnsEnabled || Boolean(form.primaryDns || form.secondaryDns) || form.mtu !== 1400 || form.mru !== 1400
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const api = getRouterApi()
    const result = unwrap(
      props.kind === 'pptp' ? await api.updatePptpServer({ ...form }) : await api.updateL2tpServer({ ...form }),
    )
    toast.success(t('common.configApplied'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

watch(() => props.kind, () => void load())
onMounted(() => void load())
</script>

<template>
  <div>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <div class="settings-form">
        <UiFormRow :label="serverSettingLabel">
          <label class="switch">
            <input v-model="form.enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiFormRow>

        <template v-if="form.enabled">
          <UiField layout="horizontal" :label="t('vpn.startIp')">
            <input v-model="form.startIp" autocomplete="off" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.endIp')">
            <input v-model="form.endIp" autocomplete="off" />
          </UiField>
          <UiField layout="horizontal" :label="t('vpn.serverAddress')">
            <input v-model="form.server" readonly />
          </UiField>

          <UiField v-if="kind === 'pptp'" layout="horizontal" :label="t('vpn.mppeEncryption')">
            <UiSelect v-model="mppeModel" :options="mppeOptions" />
          </UiField>
          <UiField v-else layout="horizontal" :label="t('vpn.ipsec')">
            <UiSelect v-model="ipsecSel" :options="ipsecOptions" />
          </UiField>
          <UiField v-if="kind === 'l2tp' && form.ipsecEnabled" layout="horizontal" :label="t('vpn.ipsecKey')">
            <input v-model="form.ipsecKey" type="password" autocomplete="new-password" />
          </UiField>

          <div class="adv-toggle-row">
            <span />
            <label class="adv-check">
              <input v-model="showAdvanced" type="checkbox" />
              <span>{{ t('vpn.showAdvanced') }}</span>
            </label>
          </div>

          <div v-if="showAdvanced" class="subsection">
            <UiFormRow :label="t('vpn.dnsServerSettings')">
              <label class="switch">
                <input v-model="form.dnsEnabled" type="checkbox" />
                <span class="slider" />
                <span class="state">{{ form.dnsEnabled ? t('common.on') : t('common.off') }}</span>
              </label>
            </UiFormRow>
            <template v-if="form.dnsEnabled">
              <UiField layout="horizontal" :label="t('vpn.primaryDns')">
                <input v-model="form.primaryDns" autocomplete="off" />
              </UiField>
              <UiField layout="horizontal" :label="t('vpn.secondaryDns')">
                <input v-model="form.secondaryDns" autocomplete="off" />
              </UiField>
            </template>
            <UiField layout="horizontal" :label="t('vpn.mtu')">
              <input v-model.number="form.mtu" type="number" min="576" max="1492" />
            </UiField>
            <UiField layout="horizontal" :label="t('vpn.mru')">
              <input v-model.number="form.mru" type="number" min="576" max="1492" />
            </UiField>
          </div>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>
