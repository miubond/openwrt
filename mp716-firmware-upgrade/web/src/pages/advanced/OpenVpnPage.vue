<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiFormRow from '@/components/UiFormRow.vue'
import FormActions from '@/components/FormActions.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { OpenVpnConfig } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const uploading = ref(false)
const configFile = ref<File | null>(null)
const certFile = ref<File | null>(null)
const configName = ref('')
const certName = ref('')
const configInput = ref<HTMLInputElement | null>(null)
const certInput = ref<HTMLInputElement | null>(null)
const form = ref<OpenVpnConfig>({
  enabled: false,
  status: 2,
  mode: 0,
  host: '',
  username: '',
  password: '',
  port: 1194,
  configUploaded: false,
})

const statusText = computed(() => {
  if (form.value.status === 1) return t('vpn.connSuccess')
  if (form.value.status === 0) return t('vpn.connFailed')
  return t('common.disconnected')
})

async function load() {
  loading.value = true
  try {
    const data = unwrap(await getRouterApi().getOpenVpn())
    form.value = { ...data }
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function takeFile(event: Event, target: 'config' | 'cert') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (target === 'config') {
    configFile.value = file
    configName.value = file?.name || ''
  } else {
    certFile.value = file
    certName.value = file?.name || ''
  }
}

async function upload(kind: 'config' | 'cert') {
  const file = kind === 'config' ? configFile.value : certFile.value
  if (!file) {
    toast.error(kind === 'config' ? t('vpn.pickConfigFile') : t('vpn.pickCertFile'))
    return
  }
  uploading.value = true
  try {
    unwrap(await getRouterApi().uploadOpenVpn(file, kind))
    if (kind === 'config') form.value.configUploaded = true
    toast.success(kind === 'config' ? t('vpn.configUploaded') : t('vpn.certUploaded'))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    uploading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateOpenVpn({ ...form.value }))
    toast.success(t('vpn.openVpnApplied'))
    if (result.rollbackSec > 0) await begin(asApplyHandle(result))
    await load()
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
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else>
      <div class="settings-form">
        <UiFormRow :label="t('vpn.openVpnClientSettings')">
          <label class="switch">
            <input v-model="form.enabled" type="checkbox" />
            <span class="slider" />
            <span class="state">{{ form.enabled ? t('common.on') : t('common.off') }}</span>
          </label>
        </UiFormRow>

        <UiFormRow :label="t('vpn.connectionStatus')">
          <div class="value">{{ statusText }}</div>
        </UiFormRow>

        <template v-if="form.enabled">
          <UiField layout="horizontal" :label="t('vpn.configMode')">
            <div class="radios">
              <label class="radio">
                <input v-model.number="form.mode" type="radio" :value="0" />
                <span>{{ t('vpn.formConfig') }}</span>
              </label>
              <label class="radio">
                <input v-model.number="form.mode" type="radio" :value="1" />
                <span>{{ t('vpn.uploadFile') }}</span>
              </label>
            </div>
          </UiField>

          <template v-if="form.mode === 0">
            <UiField layout="horizontal" :label="t('vpn.hostname')">
              <input v-model="form.host" maxlength="32" autocomplete="off" />
            </UiField>
            <UiField layout="horizontal" :label="t('vpn.username')">
              <input v-model="form.username" maxlength="32" autocomplete="off" />
            </UiField>
            <UiField layout="horizontal" :label="t('vpn.password')">
              <input v-model="form.password" type="password" maxlength="32" autocomplete="new-password" />
            </UiField>
            <UiField layout="horizontal" :label="t('vpn.port')">
              <input v-model.number="form.port" type="number" min="80" max="65535" />
            </UiField>
          </template>

          <template v-else>
            <UiField layout="horizontal" :label="t('vpn.configFile')" :hint="t('vpn.configFileHint')">
              <div class="picker">
                <input ref="configInput" class="hidden" type="file" @change="takeFile($event, 'config')" />
                <div class="file-box">
                  <input class="name" :value="configName" readonly />
                  <button class="select" type="button" @click="configInput?.click()">{{ t('vpn.pickFile') }}</button>
                </div>
                <UiButton variant="secondary" :disabled="uploading || !configFile" @click="upload('config')">
                  {{ t('vpn.upload') }}
                </UiButton>
              </div>
            </UiField>
            <p v-if="form.configUploaded" class="ok">{{ t('vpn.configUploaded') }}</p>
            <UiField layout="horizontal" :label="t('vpn.certFile')" :hint="t('vpn.certFileHint')">
              <div class="picker">
                <input ref="certInput" class="hidden" type="file" @change="takeFile($event, 'cert')" />
                <div class="file-box">
                  <input class="name" :value="certName" readonly />
                  <button class="select" type="button" @click="certInput?.click()">{{ t('vpn.pickFile') }}</button>
                </div>
                <UiButton variant="secondary" :disabled="uploading || !certFile" @click="upload('cert')">
                  {{ t('vpn.upload') }}
                </UiButton>
              </div>
            </UiField>
            <p class="tip">{{ t('vpn.openVpnKeyPathTip') }}</p>
          </template>
        </template>

        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.radios {
  display: flex;
  gap: 24px;
  min-height: 36px;
  align-items: center;
}

.radio {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  cursor: pointer;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.hidden {
  display: none;
}

.file-box {
  display: flex;
  flex: 1;
  min-width: 180px;
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
  padding: 0 14px;
  cursor: pointer;
  white-space: nowrap;
}

.ok,
.tip {
  margin: -8px 0 12px 156px;
  color: var(--color-muted);
  font-size: 13px;
}

.tip {
  margin-top: 0;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .ok {
    margin-left: 0;
  }
}
</style>
