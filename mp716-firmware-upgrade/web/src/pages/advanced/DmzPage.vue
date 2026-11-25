<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { DmzConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { isIpv4 } from '@/utils/validate'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const form = reactive<DmzConfig>({ enabled: false, hostIp: '' })

async function load() {
  loading.value = true
  try {
    Object.assign(form, unwrap(await getRouterApi().getDmzConfig()))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (form.enabled && !isIpv4(form.hostIp)) {
    toast.error(t('dmz.invalidHost'))
    return
  }
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateDmzConfig({ ...form }))
    notifySaved(result, 'dmz.submitted')
    await begin(asApplyHandle(result))
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
    <p class="page-desc">{{ t('dmz.pageDesc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('dmz.title')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('dmz.enable')">
          <label class="switch">
            <input v-model="form.enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiField>
        <UiField v-if="form.enabled" layout="horizontal" :label="t('dmz.hostIp')">
          <input v-model="form.hostIp" placeholder="192.168.1.100" />
        </UiField>
        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.page-desc {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: var(--fs-xs);
}
</style>