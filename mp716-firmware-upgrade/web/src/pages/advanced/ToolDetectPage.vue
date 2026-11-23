<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import FormActions from '@/components/FormActions.vue'
import UiField from '@/components/UiField.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import type { DhcpDetectServer, DiagnosticType } from '@/api'
import { useToastStore } from '@/stores/toast'
import { validateHost, validateRange, validateSource } from '@/utils/detect-input'
import { validateNativeHost, validateNativeSource } from '@/utils/native-detect-input'

const route = useRoute()
const native = import.meta.env.VITE_ROUTER_ADAPTER === 'device'
const validateTarget = native ? validateNativeHost : validateHost
const validateSourceAddress = native ? validateNativeSource : validateSource
const { t } = useI18n()
const toast = useToastStore()
const running = ref(false)
const output = ref('')
const servers = ref<DhcpDetectServer[]>([])
const outputEl = ref<HTMLTextAreaElement | null>(null)

const form = reactive({
  target: '',
  source: '',
  count: '',
  hops: '10',
  timeout: '5',
})
const errors = reactive({
  target: '',
  source: '',
  count: '',
  hops: '',
  timeout: '',
})

const tool = computed(() => (typeof route.meta.tool === 'string' ? route.meta.tool : 'ping'))
const kind = computed<DiagnosticType | null>(() => {
  if (tool.value === 'ping') return 'ping'
  if (tool.value === 'tracert') return 'traceroute'
  if (tool.value === 'dhcp-test') return 'dhcp'
  return null
})

let session = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pullSeq = 0

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
}

function resetForm() {
  form.target = ''
  form.source = ''
  form.count = ''
  form.hops = '10'
  form.timeout = '5'
  errors.target = ''
  errors.source = ''
  errors.count = ''
  errors.hops = ''
  errors.timeout = ''
}

function waitMs(type: DiagnosticType) {
  return type === 'ping' ? 1500 : 2500
}

function applyErrors() {
  errors.target = ''
  errors.source = ''
  errors.count = ''
  errors.hops = ''
  errors.timeout = ''
  if (kind.value === 'ping') {
    errors.target = validateTarget(form.target, t)
    errors.source = validateSourceAddress(form.source, t)
    errors.count = validateRange(
      form.count,
      1,
      100,
      t('validation.detect.pingCountRequired'),
      t('validation.detect.pingCountRange'),
    )
    return !errors.target && !errors.source && !errors.count
  }
  if (kind.value === 'traceroute') {
    errors.target = validateTarget(form.target, t)
    errors.hops = validateRange(
      form.hops,
      1,
      20,
      t('validation.detect.hopsRequired'),
      t('validation.detect.hopsRange'),
    )
    errors.timeout = validateRange(
      form.timeout,
      1,
      10,
      t('validation.detect.timeoutRequired'),
      t('validation.detect.timeoutRange'),
    )
    return !errors.target && !errors.hops && !errors.timeout
  }
  return true
}

function schedule(id: number, type: DiagnosticType) {
  clearTimer()
  timer = setTimeout(() => {
    void pull(id, type, false)
  }, waitMs(type))
}

async function pull(id: number, type: DiagnosticType, quiet: boolean) {
  const seq = ++pullSeq
  try {
    const snap = unwrap(await getRouterApi().pollDiagnostic(type))
    if (id !== session || seq !== pullSeq) return
    output.value = snap.output
    servers.value = snap.servers
    running.value = snap.running
    if (type === 'dhcp' && snap.flag === 2 && snap.servers.length === 0) {
      toast.success(t('toolDetect.noDhcp'))
    }
    if (snap.running) schedule(id, type)
  } catch (e) {
    if (id !== session || seq !== pullSeq) return
    if (!quiet) {
      running.value = false
      toast.error(formatApiError(e, t))
    }
  }
}

async function start() {
  const type = kind.value
  if (!type || running.value) return
  if (!applyErrors()) return
  const id = ++session
  running.value = true
  output.value = ''
  servers.value = []
  clearTimer()
  try {
    unwrap(
      await getRouterApi().startDiagnostic(
        type === 'ping'
          ? { type, target: form.target.trim(), source: form.source.trim(), count: Number(form.count) }
          : type === 'traceroute'
            ? {
                type,
                target: form.target.trim(),
                maxHops: Number(form.hops),
                timeoutSec: Number(form.timeout),
              }
            : { type, target: '' },
      ),
    )
    if (id !== session) return
    schedule(id, type)
  } catch (e) {
    if (id !== session) return
    running.value = false
    toast.error(formatApiError(e, t))
  }
}

async function stop() {
  const type = kind.value
  if (!type) return
  session += 1
  running.value = false
  clearTimer()
  try {
    unwrap(await getRouterApi().stopDiagnostic(type))
  } catch (e) {
    toast.error(formatApiError(e, t))
  }
}

watch(output, async () => {
  await nextTick()
  if (outputEl.value) outputEl.value.scrollTop = outputEl.value.scrollHeight
})

watch(
  kind,
  (type) => {
    const id = ++session
    clearTimer()
    running.value = false
    output.value = ''
    servers.value = []
    resetForm()
    if (type) void pull(id, type, true)
  },
  { immediate: true },
)

onUnmounted(() => {
  session += 1
  clearTimer()
})
</script>

<template>
  <div>
    <UiCard v-if="tool !== 'dhcp-test'">
      <div class="settings-form">
        <template v-if="tool === 'ping'">
          <UiField layout="horizontal" :label="t('toolDetect.host')" :error="errors.target || null">
            <input v-model="form.target" autocomplete="off" @input="errors.target = ''" />
          </UiField>
          <UiField layout="horizontal" :label="t('toolDetect.source')" :hint="native ? t('toolDetect.sourceAutoHint') : undefined" :error="errors.source || null">
            <input v-model="form.source" autocomplete="off" @input="errors.source = ''" />
          </UiField>
          <UiField layout="horizontal" :label="t('toolDetect.pingCount')" :error="errors.count || null">
            <input v-model="form.count" inputmode="numeric" autocomplete="off" @input="errors.count = ''" />
          </UiField>
        </template>

        <template v-else-if="tool === 'tracert'">
          <UiField layout="horizontal" :label="t('toolDetect.host')" :error="errors.target || null">
            <input v-model="form.target" autocomplete="off" @input="errors.target = ''" />
          </UiField>
          <UiField layout="horizontal" :label="t('toolDetect.maxHops')" :error="errors.hops || null">
            <input v-model="form.hops" inputmode="numeric" autocomplete="off" @input="errors.hops = ''" />
          </UiField>
          <UiField layout="horizontal" :label="t('toolDetect.timeout')" :error="errors.timeout || null">
            <input v-model="form.timeout" inputmode="numeric" autocomplete="off" @input="errors.timeout = ''" />
          </UiField>
        </template>

        <div class="detect-actions" :class="{ detecting: running }">
          <FormActions
            v-if="running"
            variant="danger"
            :label="t('common.stopDetect')"
            @apply="stop"
          />
          <FormActions v-else :label="t('common.startDetect')" @apply="start" />
        </div>
      </div>

      <textarea ref="outputEl" class="result" readonly rows="12" :value="output" />
    </UiCard>

    <UiCard v-else :title="t('toolDetect.dhcpList')">
      <template #actions>
        <UiButton
          class="dhcp-detect-btn"
          :class="{ detecting: running }"
          :variant="running ? 'danger' : 'primary'"
          @click="running ? stop() : start()"
        >
          {{ running ? t('common.stopDetect') : t('common.startDetect') }}
        </UiButton>
      </template>
      <div class="table-wrap">
        <table class="table detect-table">
          <thead>
            <tr>
              <th>{{ t('common.index') }}</th>
              <th>{{ t('toolDetect.dhcpIp') }}</th>
              <th>{{ t('toolDetect.dhcpMac') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!servers.length">
              <td colspan="3" class="table-empty">{{ t('common.empty') }}</td>
            </tr>
            <tr v-for="(row, index) in servers" :key="`${row.ip}-${row.mac}-${index}`">
              <td>{{ index + 1 }}</td>
              <td>{{ row.ip || '—' }}</td>
              <td class="mac">{{ row.mac ? row.mac.toUpperCase() : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.detect-actions {
  margin-top: 6px;
}
.detecting :deep(.btn)::after {
  content: '';
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 8px;
  border: 2px solid #fff;
  border-right-color: transparent;
  border-radius: 50%;
  vertical-align: -1px;
  animation: spin 0.8s linear infinite;
}
.result {
  width: 100%;
  min-height: 240px;
  margin-top: 8px;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-title);
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}
.dhcp-detect-btn.detecting::after {
  content: '';
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 8px;
  border: 2px solid #fff;
  border-right-color: transparent;
  border-radius: 50%;
  vertical-align: -1px;
  animation: spin 0.8s linear infinite;
}
.detect-table {
  min-width: 0;
}
.detect-table th,
.detect-table td {
  text-align: center;
}
.table-empty {
  padding: 32px 16px !important;
  text-align: center;
  color: var(--color-muted);
  font-size: 13px;
}
.mac {
  font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
