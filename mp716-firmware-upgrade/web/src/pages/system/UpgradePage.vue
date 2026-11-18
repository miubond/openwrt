<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import LoadingState from '@/components/LoadingState.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import type { FirmwareInfo } from '@/api'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const uploading = ref(false)
const keepSettings = ref(true)
const info = ref<FirmwareInfo | null>(null)
const file = ref<File | null>(null)
const fileName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

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

function onFile(e: Event) {
  const next = (e.target as HTMLInputElement).files?.[0] ?? null
  file.value = next
  fileName.value = next?.name || ''
}

async function doUpgrade() {
  if (!file.value) {
    toast.error(t('upgrade.noFile'))
    return
  }
  const maxBytes = info.value?.maxBytes ?? 0
  if (maxBytes > 0 && file.value.size > maxBytes) {
    const tip = info.value?.maxSizeLabel
    toast.error(tip ? t('upgrade.maxSize', { tip }) : t('upgrade.fileTooBig'))
    return
  }
  uploading.value = true
  try {
    const result = unwrap(
      await getRouterApi().uploadFirmware(file.value, { keepSettings: keepSettings.value }),
    )
    if (result.validated && result.flashWrite === false) {
      toast.success(result.message || t('upgrade.successValidateOnly'))
    } else {
      toast.success(result.message || t('upgrade.success'))
    }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    uploading.value = false
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

        <div class="row upload-row">
          <div class="label">{{ t('upgrade.fileLabel') }}</div>
          <div class="picker">
            <input ref="fileInput" class="hidden" type="file" @change="onFile" />
            <div class="file-box">
              <input class="name" :value="fileName" readonly />
              <button class="select" type="button" @click="pickFile">{{ t('upgrade.pick') }}</button>
            </div>
            <UiButton variant="secondary" :disabled="uploading || !file" @click="doUpgrade">
              {{ uploading ? t('upgrade.submitting') : t('upgrade.submit') }}
            </UiButton>
          </div>
        </div>

        <div class="row keep-row">
          <div class="label" />
          <label class="keep">
            <input v-model="keepSettings" type="checkbox" />
            {{ t('upgrade.keepSettings') }}
          </label>
        </div>

        <p v-if="info?.maxSizeLabel" class="hint">{{ t('upgrade.maxSize', { tip: info.maxSizeLabel }) }}</p>
        <p class="warn">{{ t('upgrade.warnRun') }}</p>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.upgrade-form {
  max-width: 720px;
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
