<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import { STREAM_CGI } from '@/api/factory-endpoints'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const uploading = ref(false)
const fileName = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const progressOpen = ref(false)
const progressSec = ref(0)
const reconnectIp = ref('')
const MAX_BYTES = 2 * 1024 * 1024
let progressTimer: number | undefined

/** 对齐原厂：GET cgi_stream.cgi?streamid=2，文件名 Configfile */
const downloadUrl = `${STREAM_CGI}?streamid=2`

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const next = input.files?.[0] ?? null
  file.value = next
  fileName.value = next?.name || ''
}

function clearProgressTimer() {
  if (progressTimer !== undefined) {
    window.clearTimeout(progressTimer)
    progressTimer = undefined
  }
}

function finishProgress() {
  progressOpen.value = false
  const ip = reconnectIp.value.trim()
  if (ip) {
    window.location.href = `http://${ip}/`
    return
  }
  toast.success(t('sysBackup.importOk'))
}

async function upload() {
  if (!file.value) {
    toast.error(t('sysBackup.noFile'))
    return
  }
  if (file.value.size > MAX_BYTES) {
    toast.error(t('sysBackup.fileTooBig'))
    return
  }
  uploading.value = true
  try {
    const result = unwrap(await getRouterApi().restoreConfig(file.value))
    file.value = null
    fileName.value = ''
    if (fileInput.value) fileInput.value.value = ''
    const wait = result.progressSec ?? 0
    if (wait > 0) {
      progressSec.value = wait
      reconnectIp.value = result.reconnect && result.reconnectIp ? result.reconnectIp : ''
      progressOpen.value = true
      clearProgressTimer()
      progressTimer = window.setTimeout(finishProgress, wait * 1000)
    } else {
      toast.success(t('sysBackup.importOk'))
    }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    uploading.value = false
  }
}

onBeforeUnmount(() => clearProgressTimer())
</script>

<template>
  <div class="stack">
    <UiCard :title="t('sysBackup.downloadTitle')">
      <div class="down-btn">
        <a :href="downloadUrl" download="Configfile">{{ t('sysBackup.downloadBtn') }}</a>
      </div>
    </UiCard>

    <UiCard :title="t('sysBackup.importTitle')">
      <div class="restore-row">
        <div class="restore-label">{{ t('sysBackup.importLabel') }}</div>
        <div class="picker">
          <input ref="fileInput" class="hidden" type="file" @change="onFileChange" />
          <div class="file-box">
            <input class="name" :value="fileName" readonly :placeholder="t('sysBackup.noFile')" />
            <button class="select" type="button" @click="pickFile">{{ t('sysBackup.select') }}</button>
          </div>
          <button class="upload-btn" type="button" :disabled="uploading || !file" @click="upload">
            {{ uploading ? t('sysBackup.uploading') : t('sysBackup.upload') }}
          </button>
        </div>
      </div>
      <p class="hint">{{ t('sysBackup.fileMaxHint') }}</p>
    </UiCard>

    <div v-if="progressOpen" class="progress-mask" role="alertdialog" aria-live="polite">
      <div class="progress-box">
        <p>{{ t('sysBackup.restoring') }}</p>
        <p v-if="progressSec">{{ t('sysBackup.restoringAbout', { n: progressSec }) }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stack {
  display: grid;
  gap: 24px;
}

/* 对齐原厂 .down-btn */
.down-btn {
  display: flex;
  justify-content: center;
  padding: 28px 0 16px;
}

.down-btn a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  height: 36px;
  padding: 0 20px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg-muted);
  color: var(--color-primary);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  text-decoration: none;
  line-height: 1;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.down-btn a:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.restore-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  column-gap: 16px;
  align-items: center;
}

.restore-label {
  color: var(--color-title);
  font-size: 14px;
  font-weight: 500;
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
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}

.file-box:focus-within {
  border-color: var(--color-primary);
  background: var(--color-surface);
  box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.1);
}

.name {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 0 12px;
  background: transparent;
  color: var(--color-title);
}

.name:focus {
  outline: none;
}

.name::placeholder {
  color: var(--color-muted);
}

/* 对齐原厂 .button_up */
.select {
  border: 0;
  border-left: 1px solid var(--color-border);
  background: var(--color-primary);
  color: #fff;
  padding: 0 16px;
  cursor: pointer;
  white-space: nowrap;
}

.select:focus {
  outline: none;
}

.select:focus-visible {
  background: var(--color-primary-hover, #0958d9);
}

/* 对齐原厂 .button_sumit：浅底描边上传按钮 */
.upload-btn {
  appearance: none;
  height: 36px;
  min-width: 88px;
  padding: 0 18px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-soft);
  color: var(--color-text);
  font-size: var(--fs-base);
  font-weight: var(--fw-medium);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}

.upload-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.upload-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.hint {
  margin: 10px 0 0 136px;
  color: var(--color-muted);
  font-size: 13px;
}

.progress-mask {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal, 300);
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.45);
}

.progress-box {
  width: min(360px, 100%);
  padding: 24px 20px;
  border-radius: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-menu);
  text-align: center;
}

.progress-box p {
  margin: 0;
  color: var(--color-title);
  font-size: var(--fs-base);
  line-height: 1.5;
}

.progress-box p + p {
  margin-top: 8px;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}

@media (max-width: 640px) {
  .restore-row {
    grid-template-columns: 1fr;
  }

  .hint {
    margin-left: 0;
  }
}
</style>
