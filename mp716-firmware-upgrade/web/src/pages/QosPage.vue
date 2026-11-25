<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import UiToggle from '@/components/UiToggle.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { QosCapability, QosConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const capability = ref<QosCapability | null>(null)
const form = reactive<QosConfig>({
  enabled: false,
  uploadKbps: 0,
  downloadKbps: 0,
})

async function load() {
  loading.value = true
  try {
    capability.value = unwrap(await getRouterApi().getQosCapability())
    if (capability.value.supported) {
      Object.assign(form, unwrap(await getRouterApi().getQosConfig()))
    }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!capability.value?.supported) return
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateQosConfig({ ...form }))
    toast.success(t('qos.submitted'))
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
    <p class="page-desc">{{ t('qos.pageDesc') }}</p>
    <ApplyBanner
      v-if="pending"
      :remaining="remaining"
      :applying="applying"
      @confirm="confirm"
      @cancel="cancel"
    />
    <LoadingState v-if="loading" />
    <UiCard v-else-if="capability && !capability.supported" :title="t('qos.notEnabledTitle')">
      <p>
        {{ t('qos.notEnabledReason', { reason: capability.reason || t('qos.noSqm') }) }}
      </p>
      <p class="sub">{{ t('qos.probeNote') }}</p>
    </UiCard>
    <UiCard v-else :title="t('qos.bandwidthTitle')">
      <div class="settings-form">
        <UiToggle v-model="form.enabled" :label="t('qos.enable')" :description="t('qos.enableDesc')" />
        <UiField layout="horizontal" :label="t('qos.downloadLimit')">
          <input v-model.number="form.downloadKbps" type="number" min="0" />
        </UiField>
        <UiField layout="horizontal" :label="t('qos.uploadLimit')">
          <input v-model.number="form.uploadKbps" type="number" min="0" />
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
.sub {
  color: var(--color-muted);
  font-size: var(--fs-xs);
}
</style>
