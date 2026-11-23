<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiField from '@/components/UiField.vue'
import UiIcon from '@/components/UiIcon.vue'
import FormActions from '@/components/FormActions.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const router = useRouter()
const auth = useAuthStore()
const saving = ref(false)
const showOld = ref(false)
const showNew = ref(false)
const showConfirm = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

async function save() {
  if (!oldPassword.value) {
    toast.error(t('sysPassword.errOldRequired'))
    return
  }
  if (newPassword.value.length < 5 || newPassword.value.length > 32) {
    toast.error(t('sysPassword.errNewLen'))
    return
  }
  if (oldPassword.value.length < 5 || oldPassword.value.length > 32) {
    toast.error(t('sysPassword.errOldLen'))
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    toast.error(t('sysPassword.errMismatch'))
    return
  }
  if (oldPassword.value === newPassword.value) {
    toast.error(t('sysPassword.errSame'))
    return
  }
  saving.value = true
  try {
    unwrap(
      await getRouterApi().changeAdminPassword({
        oldPassword: oldPassword.value,
        newPassword: newPassword.value,
      }),
    )
    auth.setSession(null)
    toast.success(t('sysPassword.successRelogin'))
    await router.replace('/login')
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <UiCard :subtitle="t('sysPassword.subtitle')">
      <div class="settings-form admin-form">
        <UiField layout="horizontal" :label="t('sysPassword.oldPassword')">
          <div class="pwd">
            <input v-model="oldPassword" :type="showOld ? 'text' : 'password'" autocomplete="current-password" />
            <button
              class="eye"
              type="button"
              :aria-pressed="showOld"
              :aria-label="showOld ? t('login.hidePassword') : t('login.showPassword')"
              :title="showOld ? t('login.hidePassword') : t('login.showPassword')"
              @click="showOld = !showOld"
            >
              <UiIcon :name="showOld ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>
        <UiField layout="horizontal" :label="t('sysPassword.newPassword')">
          <div class="pwd">
            <input v-model="newPassword" :type="showNew ? 'text' : 'password'" autocomplete="new-password" />
            <button
              class="eye"
              type="button"
              :aria-pressed="showNew"
              :aria-label="showNew ? t('login.hidePassword') : t('login.showPassword')"
              :title="showNew ? t('login.hidePassword') : t('login.showPassword')"
              @click="showNew = !showNew"
            >
              <UiIcon :name="showNew ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>
        <UiField layout="horizontal" :label="t('sysPassword.confirmPassword')">
          <div class="pwd">
            <input v-model="confirmPassword" :type="showConfirm ? 'text' : 'password'" autocomplete="new-password" />
            <button
              class="eye"
              type="button"
              :aria-pressed="showConfirm"
              :aria-label="showConfirm ? t('login.hidePassword') : t('login.showPassword')"
              :title="showConfirm ? t('login.hidePassword') : t('login.showPassword')"
              @click="showConfirm = !showConfirm"
            >
              <UiIcon :name="showConfirm ? 'eyeOff' : 'eye'" :size="16" />
            </button>
          </div>
        </UiField>
        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.pwd {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 360px;
  height: 40px;
  padding: 0 12px 0 16px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-muted);
  border: 1px solid transparent;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.pwd:focus-within {
  background: var(--color-surface);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.pwd input {
  flex: 1;
  border: 0 !important;
  background: transparent !important;
  color: var(--color-title) !important;
  height: 100%;
  padding: 0 !important;
  box-shadow: none !important;
}

.pwd input::placeholder {
  color: var(--color-muted);
}

.eye {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--color-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.eye:hover {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

</style>
