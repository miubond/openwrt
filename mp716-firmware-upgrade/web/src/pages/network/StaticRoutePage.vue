<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import UiSelect from '@/components/UiSelect.vue'
import FormActions from '@/components/FormActions.vue'
import UiToggle from '@/components/UiToggle.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { NetworkStaticRoute } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { isIpv4 } from '@/utils/validate'

interface StaticRouteUi extends NetworkStaticRoute {
  id?: string
}

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const routes = ref<StaticRouteUi[]>([])

const draft = reactive<StaticRouteUi>({
  enabled: true,
  interface: 'wan',
  target: '',
  netmask: '255.255.255.0',
  gateway: '',
  metric: 0,
})

const ifaceOptions = [
  { value: 'wan', label: 'WAN' },
  { value: 'lan', label: 'LAN' },
]

function addRoute() {
  if (!isIpv4(draft.target) || !isIpv4(draft.gateway) || !isIpv4(draft.netmask)) {
    toast.error(t('staticRoute.invalidRule'))
    return
  }
  routes.value.push({
    ...draft,
    id: `mp716_rt_${routes.value.length}`,
  })
  draft.target = ''
  draft.gateway = ''
}

function removeAt(index: number) {
  routes.value.splice(index, 1)
  routes.value = routes.value.map((r, i) => ({ ...r, id: `mp716_rt_${i}` }))
}

async function load() {
  loading.value = true
  try {
    routes.value = [...unwrap(await getRouterApi().getStaticRoutes())]
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const payload: NetworkStaticRoute[] = routes.value.map((r, i) => ({
      id: r.id || `mp716_rt_${i}`,
      enabled: r.enabled !== false,
      interface: (r.interface === 'lan' ? 'lan' : 'wan') as 'wan' | 'lan',
      target: r.target.trim(),
      netmask: r.netmask.trim() || '255.255.255.0',
      gateway: r.gateway.trim(),
      metric: r.metric ?? 0,
    }))
    const result = unwrap(await getRouterApi().updateStaticRoutes(payload))
    toast.success(t('staticRoute.submitted'))
    await begin(asApplyHandle(result))
    await load()
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    saving.value = false
  }
}

async function restoreActiveTask() {
  const api = getRouterApi()
  if (!api.getActiveConfigTask) return
  try {
    const active = unwrap(await api.getActiveConfigTask())
    if (active?.taskId && active.state === 'pending')
      await begin(
        asApplyHandle({
          accepted: true,
          taskId: active.taskId,
          rollbackSec: active.remainingSec || 60,
          phase: active.phase,
        }),
      )
  } catch {
    /* ignore */
  }
}

onMounted(async () => {
  await load()
  await restoreActiveTask()
})
</script>

<template>
  <div>
    <p class="page-desc">{{ t('staticRoute.pageDesc') }}</p>
    <ApplyBanner
      v-if="pending"
      :remaining="remaining"
      :applying="applying"
      @confirm="confirm"
      @cancel="cancel"
    />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('staticRoute.title')">
      <EmptyState v-if="!routes.length" :title="t('staticRoute.empty')" class="mb-3" />
      <table v-else class="table mb-3">
        <thead>
          <tr>
            <th>{{ t('staticRoute.iface') }}</th>
            <th>{{ t('staticRoute.target') }}</th>
            <th>{{ t('staticRoute.gateway') }}</th>
            <th>{{ t('staticRoute.enabled') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, idx) in routes" :key="row.id || idx">
            <td>{{ row.interface.toUpperCase() }}</td>
            <td>{{ row.target }}/{{ row.netmask }}</td>
            <td>{{ row.gateway }}</td>
            <td>{{ row.enabled ? t('common.on') : t('common.off') }}</td>
            <td>
              <UiButton variant="ghost" size="sm" @click="removeAt(idx)">{{ t('common.delete') }}</UiButton>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="settings-form add-block">
        <UiToggle v-model="draft.enabled" :label="t('staticRoute.enabled')" />
        <UiField :label="t('staticRoute.iface')">
          <UiSelect v-model="draft.interface" :options="ifaceOptions" />
        </UiField>
        <UiField :label="t('staticRoute.target')">
          <input v-model="draft.target" type="text" :placeholder="t('staticRoute.targetPlaceholder')" />
        </UiField>
        <UiField :label="t('staticRoute.netmask')">
          <input v-model="draft.netmask" type="text" />
        </UiField>
        <UiField :label="t('staticRoute.gateway')">
          <input v-model="draft.gateway" type="text" />
        </UiField>
        <UiButton type="button" @click="addRoute">{{ t('staticRoute.add') }}</UiButton>
      </div>
      <FormActions :loading="saving" @apply="save" />
    </UiCard>
  </div>
</template>

<style scoped>
.page-desc {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: var(--fs-xs);
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}
.table th,
.table td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
}
.mb-3 {
  margin-bottom: 12px;
}
.add-block {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}
</style>