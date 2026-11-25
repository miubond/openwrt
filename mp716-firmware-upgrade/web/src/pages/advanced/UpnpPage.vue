<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { UpnpConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const form = reactive<UpnpConfig>({ supported: true, enabled: false })

async function load() {
  loading.value = true
  try {
    Object.assign(form, unwrap(await getRouterApi().getUpnpConfig()))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateUpnpConfig({ enabled: form.enabled }))
    notifySaved(result, 'upnp.submitted')
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
    <p class="page-desc">{{ t('upnp.pageDesc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <EmptyState v-else-if="form.supported === false" :title="t('upnp.notSupportedTitle')" :description="t('upnp.notSupportedDesc')" />
    <UiCard v-else :title="t('upnp.title')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('upnp.enable')">
          <label class="switch">
            <input v-model="form.enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
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