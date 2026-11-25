<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import FormActions from '@/components/FormActions.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import UiSelect from '@/components/UiSelect.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { FirewallRule } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const rows = ref<FirewallRule[]>([])

const actionOptions = computed(() => [
  { value: 'ACCEPT', label: t('firewall.actionAccept') },
  { value: 'DROP', label: t('firewall.actionDrop') },
  { value: 'REJECT', label: t('firewall.actionReject') },
])

async function load() {
  loading.value = true
  try {
    rows.value = unwrap(await getRouterApi().getFirewallRules())
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function addRule() {
  rows.value.push({
    id: `fw-${Date.now()}`,
    name: t('firewall.newRuleName'),
    enabled: true,
    src: 'lan',
    dest: 'wan',
    proto: 'tcp',
    action: 'ACCEPT',
  })
}

function removeRule(index: number) {
  rows.value.splice(index, 1)
}

async function save() {
  saving.value = true
  try {
    const result = unwrap(await getRouterApi().updateFirewallRules(rows.value))
    toast.success(t('firewall.rulesSubmitted'))
    await begin(asApplyHandle(result))
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
    <p class="page-desc">{{ t('firewall.pageDesc') }}</p>
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('firewall.basicTitle')">
      <template #actions>
        <UiButton variant="secondary" @click="addRule">{{ t('common.addRule') }}</UiButton>
      </template>

      <EmptyState
        v-if="!rows.length"
        :title="t('common.emptyRules')"
        :description="t('firewall.emptyDesc')"
      />
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('firewall.name') }}</th>
              <th>{{ t('firewall.enabled') }}</th>
              <th>{{ t('firewall.srcZone') }}</th>
              <th>{{ t('firewall.destZone') }}</th>
              <th>{{ t('firewall.proto') }}</th>
              <th>{{ t('common.action') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in rows" :key="row.id">
              <td>
                <input v-model="row.name" class="cell-input" />
              </td>
              <td>
                <label class="check">
                  <input v-model="row.enabled" type="checkbox" />
                  <span>{{ row.enabled ? t('common.on') : t('common.off') }}</span>
                </label>
              </td>
              <td>
                <input v-model="row.src" class="cell-input narrow" placeholder="lan" />
              </td>
              <td>
                <input v-model="row.dest" class="cell-input narrow" placeholder="wan" />
              </td>
              <td>
                <input v-model="row.proto" class="cell-input narrow" placeholder="tcp" />
              </td>
              <td>
                <UiSelect v-model="row.action" class="cell-select" :options="actionOptions" />
              </td>
              <td>
                <button class="link-btn danger" type="button" @click="removeRule(i)">{{ t('common.delete') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <FormActions :loading="saving" @apply="save" />
    </UiCard>
  </div>
</template>

<style scoped>
.page-desc {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}

.table-wrap {
  overflow-x: auto;
}

.cell-input {
  width: 100%;
  min-width: 72px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  background: var(--color-bg-muted);
  color: var(--color-text);
  font-size: var(--fs-sm);
  line-height: var(--lh-base);
}

.cell-input.narrow {
  min-width: 64px;
  max-width: 96px;
}

.cell-select {
  width: 100%;
  min-width: 88px;
  max-width: none;
}

.cell-select :deep(.ui-select-trigger) {
  min-height: 32px;
  padding: 4px 8px;
  font-size: var(--fs-sm);
  background: var(--color-bg-muted);
}

.cell-input:focus {
  outline: 2px solid rgba(22, 119, 255, 0.2);
  border-color: var(--color-primary);
  background: var(--color-surface);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  color: var(--color-text);
  font-size: var(--fs-sm);
  cursor: pointer;
}

.check input {
  width: 14px;
  height: 14px;
  accent-color: var(--color-primary);
}
</style>
