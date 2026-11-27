<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiModal from '@/components/UiModal.vue'
import LoadingState from '@/components/LoadingState.vue'
import { ApiCallError, formatApiError, getRouterApi, unwrap } from '@/api'
import type { FirmwareInfo, FirmwareVerificationReport } from '@/api'
import { readVerificationReport, isSignedVersionRejection } from '@/api/firmware-verification'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const router = useRouter()
const toast = useToastStore()
const loading = ref(true)
const uploading = ref(false)
const applying = ref(false)
const keepSettings = ref(true)
const info = ref<FirmwareInfo | null>(null)
const file = ref<File | null>(null)
const fileName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const verification = ref<FirmwareVerificationReport | null>(null)
const outcome = ref('')
const jobId = ref('')
const verifyReady = ref(false)

const canUpload = computed(() => info.value?.canUpgrade !== false)
const flashEnabled = computed(() => !!info.value?.flashUpgradeEnabled)
const verifyOnly = computed(() => !flashEnabled.value)
const confirmOpen = ref(false)
const canApply = computed(() => flashEnabled.value && verifyReady.value && !!jobId.value)
const outcomeKind = computed<'success' | 'warn' | 'error'>(() => {
  if (!outcome.value) return 'success'
  if (verifyReady.value && flashEnabled.value) return 'success'
  if (verifyReady.value && verifyOnly.value) return 'warn'
  return 'error'
})

function show(value?: string) {
  const raw = (value || '').trim()
  return raw || '—'
}

async function load() {
  loading.value = true
  try {
    info.value = unwrap(await getRouterApi().getFirmwareInfo())
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function pickFile() {
  fileInput.value?.click()
}

function explain(report: FirmwareVerificationReport | null, fallback: string) {
  if (isSignedVersionRejection(report)) return t('upgrade.signedVersionRejected')
  const detail = `${report?.detail || ''} ${report?.error || ''}`
  if (/not enough free memory|low_memory/i.test(detail)) return t('upgrade.memoryRejected')
  if (report?.detail) return report.detail
  return fallback
}

function onFile(e: Event) {
  const next = (e.target as HTMLInputElement).files?.[0] ?? null
  file.value = next
  fileName.value = next?.name || ''
  verification.value = null
  outcome.value = ''
  jobId.value = ''
  verifyReady.value = false
}

function validateFile(): boolean {
  if (!canUpload.value) {
    toast.error(t('upgrade.uploadDisabled'))
    return false
  }
  if (!file.value) {
    toast.error(t('upgrade.noFile'))
    return false
  }
  const maxBytes = info.value?.maxBytes ?? 0
  if (maxBytes > 0 && file.value.size > maxBytes) {
    const tip = info.value?.maxSizeLabel
    toast.error(tip ? t('upgrade.maxSize', { tip }) : t('upgrade.fileTooBig'))
    return false
  }
  return true
}

function onVerifyClick() {
  if (!validateFile()) return
  void runVerify()
}

function onApplyClick() {
  if (!canApply.value) return
  confirmOpen.value = true
}

async function runVerify() {
  if (!file.value || !validateFile()) return
  uploading.value = true
  verification.value = null
  outcome.value = ''
  jobId.value = ''
  verifyReady.value = false
  try {
    const result = unwrap(
      await getRouterApi().uploadFirmware(file.value, {
        keepSettings: keepSettings.value,
        flash: false,
      }),
    )
    verification.value = result.verificationReport || null
    jobId.value = (result.jobId || '').trim()
    verifyReady.value = !!result.validated && !!jobId.value
    outcome.value = flashEnabled.value ? t('upgrade.successVerifyReady') : t('upgrade.successValidateOnly')
    toast.success(outcome.value)
  } catch (e) {
    verification.value = readVerificationReport(e instanceof ApiCallError ? e.details : null)
    outcome.value = explain(verification.value, formatApiError(e, t))
    if (isSignedVersionRejection(verification.value)) toast.warning(outcome.value)
    else toast.error(outcome.value)
  } finally {
    uploading.value = false
  }
}

async function runApply() {
  confirmOpen.value = false
  if (!jobId.value) return
  applying.value = true
  try {
    const result = unwrap(
      await getRouterApi().applyFirmwareV2({
        jobId: jobId.value,
        keepSettings: keepSettings.value,
      }),
    )
    verification.value = result.verificationReport || verification.value
    if (result.flashWrite) {
      outcome.value = t('upgrade.applySubmitted')
      toast.success(outcome.value)
      await router.push({ name: 'sys-reboot', query: { wait: '1', firmware: '1' } })
      return
    }
    toast.error(result.message || t('upgrade.checkRejected'))
  } catch (e) {
    verification.value = readVerificationReport(e instanceof ApiCallError ? e.details : null)
    const apiCode = e instanceof ApiCallError ? e.code : ''
    if (apiCode === 'LOW_MEMORY') outcome.value = t('upgrade.memoryRejected')
    else outcome.value = explain(verification.value, formatApiError(e, t))
    toast.error(outcome.value)
  } finally {
    applying.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div>
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('upgrade.cardTitle')">
      <div class="upgrade-form">
        <div class="row">
          <div class="label">{{ t('upgrade.model') }}</div>
          <div class="value">{{ show(info?.hardware) }}</div>
        </div>
        <div class="row">
          <div class="label">{{ t('upgrade.version') }}</div>
          <div class="value">{{ show(info?.currentVersion) }}</div>
        </div>
        <div class="row">
          <div class="label">{{ t('upgrade.release') }}</div>
          <div class="value">{{ show(info?.buildDate) }}</div>
        </div>
        <p v-if="!canUpload" class="warn">{{ t('upgrade.uploadDisabled') }}</p>

        <template v-else>
          <div class="row upload-row">
            <div class="label">{{ t('upgrade.fileLabel') }}</div>
            <div class="picker">
              <input
                ref="fileInput"
                class="hidden"
                type="file"
                accept=".mp716upd,.mp7fw,.bin,application/octet-stream"
                @change="onFile"
              />
              <div class="file-box">
                <input class="name" :value="fileName" readonly />
                <button class="select" type="button" @click="pickFile">{{ t('upgrade.pick') }}</button>
              </div>
              <UiButton variant="secondary" :disabled="uploading || applying || !file" @click="onVerifyClick">
                {{ uploading ? t('upgrade.verifying') : t('upgrade.validateFirmware') }}
              </UiButton>
              <UiButton
                v-if="flashEnabled"
                variant="primary"
                :disabled="!canApply || applying || uploading"
                @click="onApplyClick"
              >
                {{ applying ? t('upgrade.upgrading') : t('upgrade.startUpgrade') }}
              </UiButton>
            </div>
          </div>

          <div class="row keep-row">
            <div class="label" />
            <label class="keep">
              <input v-model="keepSettings" type="checkbox" :disabled="!flashEnabled" />
              {{ t('upgrade.keepSettings') }}
            </label>
          </div>

          <p v-if="info?.maxSizeLabel" class="hint">{{ t('upgrade.maxSize', { tip: info.maxSizeLabel }) }}</p>
          <p v-if="verifyOnly && !verifyReady" class="hint">{{ t('upgrade.productionUploadHint') }}</p>
          <p v-else-if="verifyOnly && verifyReady" class="warn">{{ t('upgrade.verifyOnly') }}</p>
          <p v-else-if="flashEnabled" class="warn">{{ t('upgrade.warnRun') }}</p>
          <p v-if="jobId" class="hint">{{ t('upgrade.jobReady', { id: jobId }) }}</p>
          <p v-if="outcome" class="result" :class="`result--${outcomeKind}`">{{ outcome }}</p>
        </template>

        <section v-if="verification" class="verification" :aria-label="t('upgrade.validationReport')">
          <h3>{{ t('upgrade.validationReport') }}</h3>
          <p :class="verification.signature_checked ? 'signature-pass' : 'warn'">
            {{ verification.signature_checked ? t('upgrade.signaturePassed') : t('upgrade.signatureFailed') }}
          </p>
          <p v-if="!verification.ok" class="warn">
            {{ explain(verification, t('upgrade.checkRejected')) }}
          </p>
          <p>{{ t('upgrade.resultCode') }}: {{ verification.code }}</p>
          <p>{{ t('upgrade.flashWrite') }}: {{ String(verification.flash_write) }}</p>
          <p v-if="flashEnabled && verification.flash_write === false" class="hint">
            {{ t('upgrade.flashWriteVerifyPhase') }}
          </p>
          <details>
            <summary>{{ t('upgrade.rawReport') }}</summary>
            <pre>{{ JSON.stringify(verification, null, 2) }}</pre>
          </details>
        </section>
      </div>
    </UiCard>

    <UiModal
      :open="confirmOpen"
      :title="t('upgrade.confirmTitle')"
      danger
      @close="confirmOpen = false"
      @confirm="runApply"
    >
      {{ t('upgrade.confirmBody') }}
    </UiModal>
  </div>
</template>

<style scoped>
.upgrade-form {
  max-width: 720px;
}

.result {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--color-title);
  line-height: 1.5;
}

.result--success {
  border: 1px solid var(--color-success, #15803d);
  background: rgba(21, 128, 61, 0.1);
}

.result--warn {
  border: 1px solid var(--color-warning, #d48806);
  background: var(--color-warning-bg, rgba(212, 136, 6, 0.12));
}

.result--error {
  border: 1px solid var(--color-danger, #cf1322);
  background: rgba(207, 19, 34, 0.08);
}

.verification {
  margin-top: 24px;
  border-top: 1px solid var(--color-border);
  padding-top: 16px;
}

.verification p {
  margin: 8px 0;
}

.verification .warn {
  margin-left: 0;
}

.signature-pass {
  color: var(--color-success, #15803d);
}

.verification pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.verification summary {
  cursor: pointer;
  margin-top: 12px;
}

.row {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  column-gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  min-height: 28px;
}

.label {
  color: var(--color-muted);
  font-size: 14px;
}

.value {
  color: var(--color-title);
  font-size: 14px;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.hidden {
  display: none;
}

.file-box {
  display: flex;
  flex: 1;
  min-width: 240px;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--color-bg-muted);
}

.name {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 0 12px;
  background: transparent;
}

.select {
  border: 0;
  border-left: 1px solid var(--color-border);
  background: var(--color-primary);
  color: #fff;
  padding: 0 16px;
  cursor: pointer;
  white-space: nowrap;
}

.keep {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-title);
  cursor: pointer;
}

.hint,
.warn {
  margin: 4px 0 0 116px;
  font-size: 13px;
}

.hint {
  color: var(--color-muted);
}

.warn {
  color: var(--color-warning);
}

@media (max-width: 640px) {
  .row {
    grid-template-columns: 1fr;
  }

  .hint,
  .warn {
    margin-left: 0;
  }
}
</style>