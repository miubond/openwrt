<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import UiToggle from '@/components/UiToggle.vue'
import UiModal from '@/components/UiModal.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm(() => void load())
const loading = ref(true)
const refreshing = ref(false)
const saving = ref(false)
const confirmClear = ref(false)
const enabled = ref(false)
const content = ref('')
function download() {
  const url = URL.createObjectURL(new Blob([content.value], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'mp716-system.log'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function load(quiet = false) {
  if (quiet) refreshing.value = true
  else loading.value = true
  try {
    const state = unwrap(await getRouterApi().getSystemLogs())
    enabled.value = state.enabled
    content.value = state.content
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    if (quiet) refreshing.value = false
    else loading.value = false
  }
}

async function onToggle(next: boolean) {
  const previous = enabled.value
  enabled.value = next
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateSyslog(next))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    if (next) {
      const state = unwrap(await getRouterApi().getSystemLogs())
      content.value = state.content
      enabled.value = state.enabled
    } else {
      content.value = ''
    }
  } catch (e) {
    enabled.value = previous
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

async function clearLogs() {
  saving.value = true
  try {
    unwrap(await getRouterApi().clearSyslog())
    content.value = ''
    confirmClear.value = false
    toast.success(t('logs.cleared'))
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
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <UiToggle :model-value="enabled" :label="t('logs.toggle')" @update:model-value="onToggle" />
      <template v-if="enabled">
        <div class="toolbar">
          <button class="save" type="button" @click="download">{{ t('logs.saveLog') }}</button>
          <UiButton variant="secondary" :disabled="saving" @click="confirmClear = true">{{ t('logs.clear') }}</UiButton>
          <UiButton
            variant="secondary"
            :disabled="saving || refreshing"
            @click="load(true)"
          >
            {{ refreshing ? t('common.refreshing') : t('common.refresh') }}
          </UiButton>
        </div>
        <textarea class="log" readonly :value="content" />
      </template>
    </UiCard>
    <UiModal
      :open="confirmClear"
      :title="t('logs.clearTitle')"
      danger
      @close="confirmClear = false"
      @confirm="clearLogs"
    >
      <p>{{ t('logs.clearBody') }}</p>
    </UiModal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 12px 0;
}
.save {
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  background: var(--color-primary);
  color: #fff;
  text-decoration: none;
  font-size: var(--fs-sm);
}
.log {
  width: 100%;
  min-height: 320px;
  resize: vertical;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-muted);
  color: var(--color-title);
  font-family: var(--font-family-mono);
  font-size: 12px;
  line-height: 1.5;
}
</style>
