<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel, notifySaved } = useApplyConfirm()
const uploading = ref(false)
const fileName = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const MAX_BYTES = 2 * 1024 * 1024

const downloading = ref(false)
async function download() {
  downloading.value = true
  try {
    const result = unwrap(await getRouterApi().downloadBackup())
    const raw = atob(result.contentBase64)
    const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = result.filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    downloading.value = false
  }
}

function pickFile() {
  fileInput.value?.click()
}

function onFileChange(ev: Event) {
  const input = ev.target as HTMLInputElement
  const next = input.files?.[0] ?? null
  file.value = next
  fileName.value = next?.name || ''
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
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    notifySaved(result, 'sysBackup.importOk')
    file.value = null
    fileName.value = ''
    if (fileInput.value) fileInput.value.value = ''
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    uploading.value = false
  }
}
</script>

<template>
  <div class="stack">
    <ApplyBanner v-if="pending" :remaining="remaining" :phase="pending?.phase" :message="pending?.message" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <UiCard :title="t('sysBackup.downloadTitle')">
      <div class="down-btn">
        <button type="button" :disabled="downloading || applying" @click="download">
          {{ t('sysBackup.downloadBtn') }}
        </button>
      </div>
    </UiCard>

    <UiCard :title="t('sysBackup.importTitle')">
      <div class="restore-row">
        <div class="restore-label">{{ t('sysBackup.importLabel') }}</div>
        <div class="picker">
          <input ref="fileInput" class="hidden" type="file" @change="onFileChange" />
          <div class="file-box">
            <input class="name" :value="fileName" readonly />
            <button class="select" type="button" @click="pickFile">{{ t('sysBackup.select') }}</button>
          </div>
          <UiButton variant="secondary" :disabled="uploading || !file" @click="upload">
            {{ uploading ? t('sysBackup.uploading') : t('sysBackup.upload') }}
          </UiButton>
        </div>
      </div>
      <p class="hint">{{ t('sysBackup.fileMaxHint') }}</p>
    </UiCard>
  </div>
</template>

<style scoped>
.stack {
  display: grid;
  gap: 24px;
}

/* 对齐 feature/lp / 原厂 .down-btn */
.down-btn {
  display: flex;
  justify-content: center;
  padding: 28px 0 16px;
}

.down-btn button {
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
  line-height: 1;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.down-btn button:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
}

.down-btn button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
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

.select {
  border: 0;
  border-left: 1px solid var(--color-border);
  background: var(--color-primary);
  color: #fff;
  padding: 0 16px;
  cursor: pointer;
  white-space: nowrap;
}

.hint {
  margin: 10px 0 0 136px;
  color: var(--color-muted);
  font-size: 13px;
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
