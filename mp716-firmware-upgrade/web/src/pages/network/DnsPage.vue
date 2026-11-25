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
import type { DnsConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const form = reactive<DnsConfig>({ mode: 'auto', servers: ['', ''] })

const modeOptions = computed(() => [
  { value: 'auto', label: t('dns.modeAuto') },
  { value: 'manual', label: t('dns.modeManual') },
])

async function load() {
  loading.value = true
  try {
    const cfg = unwrap(await getRouterApi().getDnsConfig())
    Object.assign(form, cfg)
    while (form.servers.length < 2) form.servers.push('')
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const payload: DnsConfig = {
      mode: form.mode,
      servers: form.servers.map((s) => s.trim()).filter(Boolean),
    }
    const result = unwrap(await getRouterApi().updateDnsConfig(payload))
    toast.success(t('common.configSubmitted'))
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
    <p class="page-desc">{{ t('dns.pageDesc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('dns.title')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('dns.workMode')">
          <UiSelect v-model="form.mode" :options="modeOptions" />
        </UiField>
        <template v-if="form.mode === 'manual'">
          <UiField layout="horizontal" :label="t('dns.primaryDns')">
            <input v-model="form.servers[0]" placeholder="223.5.5.5" />
          </UiField>
          <UiField layout="horizontal" :label="t('dns.secondaryDns')">
            <input v-model="form.servers[1]" placeholder="119.29.29.29" />
          </UiField>
        </template>
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
