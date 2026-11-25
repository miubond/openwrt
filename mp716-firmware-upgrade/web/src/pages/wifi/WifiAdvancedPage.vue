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
import type { WifiAdvancedConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)

const bgprotectOptions = computed(() => [
  { value: 0, label: t('wifiBasic.channelAuto') },
  { value: 1, label: t('common.enabled') },
  { value: 2, label: t('common.disabled') },
])

const onOffOptions = computed(() => [
  { value: 0, label: t('common.disabled') },
  { value: 1, label: t('common.enabled') },
])

const txPreambleOptions = computed(() => [
  { value: 0, label: t('wifiAdvanced.preambleLong') },
  { value: 1, label: t('wifiAdvanced.preambleShort') },
  { value: 2, label: t('wifiBasic.channelAuto') },
])

const form = reactive<WifiAdvancedConfig>({
  radioOn: false,
  bgprotectMode: 0,
  beacon: 100,
  dtim: 1,
  rtsThreshold: 2347,
  fragThreshold: 2346,
  txBurst: 1,
  txPreamble: 1,
  wmm: 1,
})

async function load() {
  loading.value = true
  try {
    Object.assign(form, unwrap(await getRouterApi().getWifiAdvanced()))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateWifiAdvanced({ ...form }))
    toast.success(t('wifiAdvanced.applied'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
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
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('wifiAdvanced.title')">
      <div class="settings-form">
        <p v-if="!form.radioOn" class="off-hint">{{ t('wifiAdvanced.radioOffHint') }}</p>
        <template v-else>
          <UiField layout="horizontal" :label="t('wifiAdvanced.bgProtect')">
            <UiSelect v-model="form.bgprotectMode" :options="bgprotectOptions" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.beacon')" :hint="t('wifiAdvanced.beaconHint')">
            <input v-model.number="form.beacon" type="number" min="20" max="1024" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.dtim')" :hint="t('wifiAdvanced.dtimHint')">
            <input v-model.number="form.dtim" type="number" min="1" max="255" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.rts')" :hint="t('wifiAdvanced.rtsHint')">
            <input v-model.number="form.rtsThreshold" type="number" min="1" max="2347" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.frag')" :hint="t('wifiAdvanced.fragHint')">
            <input v-model.number="form.fragThreshold" type="number" min="256" max="2346" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.txBurst')">
            <UiSelect v-model="form.txBurst" :options="onOffOptions" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.preamble')">
            <UiSelect v-model="form.txPreamble" :options="txPreambleOptions" />
          </UiField>
          <UiField layout="horizontal" :label="t('wifiAdvanced.wmm')">
            <UiSelect v-model="form.wmm" :options="onOffOptions" />
          </UiField>
        </template>

        <FormActions v-if="form.radioOn" :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>
