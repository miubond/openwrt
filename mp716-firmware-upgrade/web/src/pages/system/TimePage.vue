<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { SystemTimeConfig } from '@/api'
import { TIME_ZONE_OPTIONS } from '@/constants/time-zones'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { formatDateTime } from '@/utils/format'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const syncing = ref(false)
const displayTime = ref('')
let tick: ReturnType<typeof setInterval> | undefined
let baseUnix = 0
let baseMs = 0

const form = reactive<SystemTimeConfig>({
  timezone: 'CST-8',
  ntpEnabled: false,
  ntpServers: ['', '', ''],
  localTime: '',
})

const timezoneOptions = computed(() => {
  const hit = TIME_ZONE_OPTIONS.some((item) => item.value === form.timezone)
  if (hit || !form.timezone) return TIME_ZONE_OPTIONS
  return [{ label: form.timezone, value: form.timezone }, ...TIME_ZONE_OPTIONS]
})

function stampNow() {
  return formatDateTime(new Date())
}

function refreshDisplay() {
  if (!baseUnix) {
    displayTime.value = form.localTime || '—'
    return
  }
  const elapsed = Math.floor((Date.now() - baseMs) / 1000)
  displayTime.value = formatDateTime(baseUnix + elapsed)
}

function setClock(localTime: string) {
  form.localTime = localTime
  const parsed = Date.parse(localTime.replace(' ', 'T'))
  if (Number.isFinite(parsed)) {
    baseUnix = Math.floor(parsed / 1000)
    baseMs = Date.now()
  }
  refreshDisplay()
}

async function load() {
  loading.value = true
  try {
    const data = unwrap(await getRouterApi().getSystemTime())
    form.timezone = data.timezone || 'CST-8'
    form.ntpEnabled = data.ntpEnabled
    form.ntpServers = [0, 1, 2].map((index) => data.ntpServers[index] ?? '')
    setClock(formatDateTime(data.localTime))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function useBrowserTime() {
  syncing.value = true
  try {
    const stamp = stampNow()
    unwrap(await getRouterApi().useBrowserTime(stamp))
    setClock(stamp)
    toast.success(t('sysTime.syncOk'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    syncing.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(
      await getRouterApi().updateSystemTime({
        ...form,
        ntpServers: [0, 1, 2].map((index) => form.ntpServers[index] ?? ''),
      }),
    )
    toast.success(t('common.configApplied'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
  tick = setInterval(refreshDisplay, 1000)
})
onUnmounted(() => {
  if (tick) clearInterval(tick)
})
</script>

<template>
  <div>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :subtitle="t('sysTime.subtitle')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('sysTime.systemTime')">
          <input :value="displayTime" readonly />
        </UiField>

        <div class="browser-row">
          <span class="spacer" />
          <UiButton variant="secondary" :disabled="syncing" @click="useBrowserTime">
            {{ syncing ? t('sysTime.syncing') : t('sysTime.useBrowserTime') }}
          </UiButton>
        </div>

        <UiField layout="horizontal" :label="t('sysTime.timezone')" :hint="t('sysTime.timezoneHint')">
          <UiSelect v-model="form.timezone" :options="timezoneOptions" />
        </UiField>

        <UiFormRow :label="t('sysTime.ntpEnable')">
          <label class="switch">
            <input v-model="form.ntpEnabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.ntpEnabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiFormRow>

        <template v-if="form.ntpEnabled">
          <UiField
            v-for="index in 3"
            :key="index"
            layout="horizontal"
            :label="t('sysTime.ntpServer', { n: index })"
          >
            <input v-model="form.ntpServers[index - 1]" />
          </UiField>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>
