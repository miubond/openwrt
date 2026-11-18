<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { LanConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { isIpv4 } from '@/utils/validate'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const form = reactive({ ip: '192.168.199.1', netmask: '255.255.255.0' })
let full: LanConfig | null = null

async function load() {
  loading.value = true
  try {
    full = unwrap(await getRouterApi().getLanConfig())
    form.ip = full.ipv4
    form.netmask = full.netmask
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!full || !isIpv4(form.ip)) {
    toast.error(t('lan.errInvalidIp'))
    return
  }
  saving.value = true
  try {
    const next: LanConfig = { ...full, ipv4: form.ip, netmask: form.netmask }
    const result = unwrap(await getRouterApi().updateLanConfig(next))
    full = next
    toast.success(t('common.configSubmitted'))
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
    <p class="page-desc">{{ t('lan.pageDesc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <template v-else>
    <UiCard>
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('lan.lanIp')">
          <input v-model="form.ip" />
        </UiField>
        <UiField layout="horizontal" :label="t('lan.netmask')">
          <input v-model="form.netmask" />
        </UiField>
        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
    </template>
  </div>
</template>
