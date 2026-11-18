<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiSelect from '@/components/UiSelect.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import type { DiagnosticResult, DiagnosticType } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const running = ref(false)
const result = ref<DiagnosticResult | null>(null)
const typeOptions = computed(() => [
  { value: 'ping' as DiagnosticType, label: 'Ping' },
  { value: 'traceroute' as DiagnosticType, label: 'Traceroute' },
  { value: 'dns' as DiagnosticType, label: 'DNS' },
])

const form = reactive<{ type: DiagnosticType; target: string }>({
  type: 'ping',
  target: '223.5.5.5',
})

async function run() {
  const target = form.target.trim()
  if (!target) {
    toast.error(t('diagnose.needTarget'))
    return
  }
  running.value = true
  result.value = null
  try {
    result.value = unwrap(await getRouterApi().runDiagnostic({ type: form.type, target, count: 4 }))
    if (result.value.success) toast.success(t('diagnose.done', { ms: result.value.durationMs }))
    else toast.info(t('diagnose.doneWarn'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    running.value = false
  }
}
</script>

<template>
  <UiCard :title="t('diagnose.title')" :subtitle="t('diagnose.subtitle')">
    <form class="form" @submit.prevent="run">
      <UiField :label="t('diagnose.type')">
        <UiSelect v-model="form.type" :options="typeOptions" />
      </UiField>
      <UiField :label="t('diagnose.target')">
        <input v-model="form.target" :placeholder="t('diagnose.targetPh')" />
      </UiField>
      <UiButton :disabled="running" type="submit">
        {{ running ? t('diagnose.running') : t('diagnose.start') }}
      </UiButton>
    </form>
    <pre v-if="result" class="output">{{ result.output }}</pre>
  </UiCard>
</template>

<style scoped>
.form {
  display: grid;
  gap: 12px;
  max-width: 480px;
  margin-bottom: 16px;
}
.output {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-x: auto;
}
</style>
