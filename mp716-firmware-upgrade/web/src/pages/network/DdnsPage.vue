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
import type { DdnsConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const form = reactive<DdnsConfig>({
  supported: true,
  enabled: false,
  provider: 'duckdns.org',
  domain: '',
  username: '',
  hostname: '',
  password: '',
})

async function load() {
  loading.value = true
  try {
    const cfg = unwrap(await getRouterApi().getDdnsConfig())
    Object.assign(form, cfg)
    if (form.password === undefined) form.password = ''
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const payload: DdnsConfig = {
      enabled: form.enabled,
      provider: form.provider.trim(),
      domain: form.domain.trim(),
      username: form.username.trim(),
      hostname: form.hostname.trim() || form.domain.trim(),
    }
    if (form.password?.trim()) payload.password = form.password.trim()
    const result = unwrap(await getRouterApi().updateDdnsConfig(payload))
    notifySaved(result, 'ddns.submitted')
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
    <p class="page-desc">{{ t('ddns.pageDesc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <EmptyState v-else-if="form.supported === false" :title="t('ddns.notSupportedTitle')" :description="t('ddns.notSupportedDesc')" />
    <UiCard v-else :title="t('ddns.title')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('ddns.enable')">
          <label class="switch">
            <input v-model="form.enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiField>
        <UiField layout="horizontal" :label="t('ddns.provider')">
          <input v-model="form.provider" />
        </UiField>
        <UiField layout="horizontal" :label="t('ddns.domain')">
          <input v-model="form.domain" />
        </UiField>
        <UiField layout="horizontal" :label="t('ddns.hostname')">
          <input v-model="form.hostname" />
        </UiField>
        <UiField layout="horizontal" :label="t('ddns.username')">
          <input v-model="form.username" autocomplete="off" />
        </UiField>
        <UiField layout="horizontal" :label="t('ddns.password')">
          <input v-model="form.password" type="password" autocomplete="new-password" :placeholder="t('ddns.passwordHint')" />
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