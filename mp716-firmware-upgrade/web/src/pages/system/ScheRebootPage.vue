<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { ScheRebootConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm(() => void load())
const loading = ref(true)
const saving = ref(false)
const clock = ref(0)
const remainTick = ref(0)

const weekdays = computed(() => [
  { label: t('sysScheReboot.weekMon'), bit: 2 },
  { label: t('sysScheReboot.weekTue'), bit: 4 },
  { label: t('sysScheReboot.weekWed'), bit: 8 },
  { label: t('sysScheReboot.weekThu'), bit: 16 },
  { label: t('sysScheReboot.weekFri'), bit: 32 },
  { label: t('sysScheReboot.weekSat'), bit: 64 },
  { label: t('sysScheReboot.weekSun'), bit: 1 },
])

const modeOptions = computed(() => [
  { value: 0, label: t('sysScheReboot.modeOff') },
  { value: 1, label: t('sysScheReboot.modeCountdown') },
  { value: 2, label: t('sysScheReboot.modeScheduled') },
])

const form = reactive<ScheRebootConfig>({
  mode: 0,
  remainHour: 0,
  remainMinute: 30,
  hour: 0,
  minute: 0,
  weeks: 0,
  timeDay: 0,
  remainingSec: 0,
})

const allDays = computed(() => form.weeks === 255 || form.weeks === 127)

function dayChecked(bit: number) {
  return form.weeks === 255 || (form.weeks & bit) !== 0
}

function selectedBits() {
  return weekdays.value.map((day) => day.bit).filter((bit) => dayChecked(bit))
}

function setWeeks(bits: number[]) {
  const sum = bits.reduce((total, bit) => total + bit, 0)
  form.weeks = sum === 127 ? 255 : sum
}

function toggleDay(bit: number, checked: boolean) {
  const bits = new Set(selectedBits())
  if (checked) bits.add(bit)
  else bits.delete(bit)
  setWeeks([...bits])
}

function toggleAll(checked: boolean) {
  form.weeks = checked ? 255 : 0
}

function formatUnix(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatRemaining(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const day = Math.floor(safe / 86400)
  const hour = Math.floor((safe % 86400) / 3600)
  const minute = Math.floor((safe % 3600) / 60)
  const second = safe % 60
  return t('sysScheReboot.remainFmt', {
    day,
    d: t('common.day'),
    hour,
    h: t('common.hour'),
    minute,
    m: t('common.minute'),
    second,
    s: t('common.second'),
  })
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

let timer: ReturnType<typeof setInterval> | undefined

async function load() {
  loading.value = true
  try {
    Object.assign(form, unwrap(await getRouterApi().getScheReboot()))
    clock.value = form.timeDay
    remainTick.value = form.remainingSec > 0 ? form.remainingSec : 0
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (form.mode === 1) {
    form.remainHour = clampInt(form.remainHour, 0, 23)
    form.remainMinute = clampInt(form.remainMinute, 0, 59)
    const total = form.remainHour * 3600 + form.remainMinute * 60
    if (total < 600) {
      toast.error(t('sysScheReboot.errMinRemain'))
      return
    }
  }
  if (form.mode === 2) {
    form.hour = clampInt(form.hour, 0, 23)
    form.minute = clampInt(form.minute, 0, 59)
    if (!form.weeks) {
      toast.error(t('sysScheReboot.errWeekdays'))
      return
    }
  }
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateScheReboot({ ...form }))
    toast.success(t('sysScheReboot.applied'))
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
  timer = setInterval(() => {
    if (form.mode !== 0 && clock.value > 0) clock.value += 1
    if (remainTick.value > 0) remainTick.value -= 1
  }, 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :subtitle="t('sysScheReboot.subtitle')">
      <div class="settings-form">
        <UiField layout="horizontal" :label="t('sysScheReboot.mode')">
          <UiSelect v-model="form.mode" :options="modeOptions" />
        </UiField>

        <UiField v-if="form.mode === 1" layout="horizontal" :label="t('sysScheReboot.countdownHm')">
          <div class="clock">
            <input v-model.number="form.remainHour" type="number" min="0" max="23" />
            <span>:</span>
            <input v-model.number="form.remainMinute" type="number" min="0" max="59" />
          </div>
        </UiField>

        <template v-if="form.mode === 2">
          <UiFormRow :label="t('sysScheReboot.weekdays')">
            <div class="days">
              <label class="day">
                <input type="checkbox" :checked="allDays" @change="toggleAll(($event.target as HTMLInputElement).checked)" />
                {{ t('sysScheReboot.selectAll') }}
              </label>
              <label v-for="day in weekdays" :key="day.bit" class="day">
                <input
                  type="checkbox"
                  :checked="dayChecked(day.bit)"
                  @change="toggleDay(day.bit, ($event.target as HTMLInputElement).checked)"
                />
                {{ day.label }}
              </label>
            </div>
          </UiFormRow>
          <UiField layout="horizontal" :label="t('sysScheReboot.rebootTimeHm')">
            <div class="clock">
              <input v-model.number="form.hour" type="number" min="0" max="23" />
              <span>:</span>
              <input v-model.number="form.minute" type="number" min="0" max="59" />
            </div>
          </UiField>
        </template>

        <template v-if="form.mode !== 0">
          <UiField layout="horizontal" :label="t('sysScheReboot.systemTime')">
            <input :value="formatUnix(clock)" readonly />
          </UiField>
          <UiField
            v-if="form.remainingSec !== 0 && remainTick > 0"
            layout="horizontal"
            :label="t('sysScheReboot.rebootCountdown')"
          >
            <div class="remain">{{ formatRemaining(remainTick) }}</div>
          </UiField>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.clock {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clock input {
  width: 88px !important;
  text-align: center;
}

.days {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
}

.day {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.remain {
  min-height: 36px;
  display: flex;
  align-items: center;
  color: var(--color-title);
}

</style>
