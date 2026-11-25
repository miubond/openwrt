<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import UiField from '@/components/UiField.vue'
import FormActions from '@/components/FormActions.vue'
import UiSelect from '@/components/UiSelect.vue'
import ApplyBanner from '@/components/ApplyBanner.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { asApplyHandle, formatApiError, getRouterApi, unwrap } from '@/api'
import type { PortForwardRule } from '@/api'
import { useApplyConfirm } from '@/composables/useApplyConfirm'
import { useToastStore } from '@/stores/toast'
import { isIpv4, isPort } from '@/utils/validate'

interface PortForwardUi {
  id?: string
  name: string
  enabled: boolean
  proto: string
  srcDport: number
  destIp: string
  destPort: number
}

const { t } = useI18n()
const toast = useToastStore()
const { pending, remaining, applying, begin, confirm, cancel } = useApplyConfirm()
const loading = ref(true)
const saving = ref(false)
const form = reactive({ portForwards: [] as PortForwardUi[] })
const protoOptions = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'tcpudp', label: 'TCP+UDP' },
]

const draft = reactive<PortForwardUi>({
  name: '',
  enabled: true,
  proto: 'tcp',
  srcDport: 8080,
  destIp: '',
  destPort: 80,
})

function ruleToUi(r: PortForwardRule): PortForwardUi {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    proto: r.proto,
    srcDport: r.extPort,
    destIp: r.intIp,
    destPort: r.intPort,
  }
}

function uiToRule(r: PortForwardUi, idx: number): PortForwardRule {
  return {
    id: r.id || `pf-${idx}`,
    name: r.name,
    enabled: r.enabled,
    proto: r.proto,
    extPort: r.srcDport,
    intIp: r.destIp,
    intPort: r.destPort,
  }
}

async function load() {
  loading.value = true
  try {
    const list = unwrap(await getRouterApi().getPortForwards())
    form.portForwards = list.map(ruleToUi)
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function addForward() {
  if (!draft.name || !isIpv4(draft.destIp) || !isPort(draft.srcDport) || !isPort(draft.destPort)) {
    toast.error(t('portForward.invalidRule'))
    return
  }
  form.portForwards.push({ ...draft })
  draft.name = ''
  draft.destIp = ''
}

async function save() {
  saving.value = true
  try {
    const payload = form.portForwards.map(uiToRule)
    const result = unwrap(await getRouterApi().updatePortForwards(payload))
    toast.success(t('portForward.submitted'))
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
    <ApplyBanner v-if="pending" :remaining="remaining" :applying="applying" @confirm="confirm" @cancel="cancel" />
    <LoadingState v-if="loading" />
    <UiCard v-else :title="t('portForward.title')">
      <EmptyState v-if="!form.portForwards.length" :title="t('common.emptyRules')" class="mb-3" />
      <table v-else class="table mb-3">
        <thead>
          <tr>
            <th>{{ t('portForward.name') }}</th>
            <th>{{ t('portForward.proto') }}</th>
            <th>{{ t('portForward.external') }}</th>
            <th>{{ t('portForward.internal') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in form.portForwards" :key="i">
            <td>{{ r.name }}</td>
            <td>{{ r.proto }}</td>
            <td>{{ r.srcDport }}</td>
            <td>{{ r.destIp }}:{{ r.destPort }}</td>
            <td>
              <button class="link-btn danger" type="button" @click="form.portForwards.splice(i, 1)">
                {{ t('common.delete') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="settings-form draft">
        <UiField layout="horizontal" :label="t('portForward.name')"><input v-model="draft.name" /></UiField>
        <UiField layout="horizontal" :label="t('portForward.proto')">
          <UiSelect v-model="draft.proto" :options="protoOptions" />
        </UiField>
        <UiField layout="horizontal" :label="t('portForward.extPort')">
          <input v-model.number="draft.srcDport" type="number" min="1" max="65535" />
        </UiField>
        <UiField layout="horizontal" :label="t('portForward.internalIp')"><input v-model="draft.destIp" /></UiField>
        <UiField layout="horizontal" :label="t('portForward.internalPort')">
          <input v-model.number="draft.destPort" type="number" min="1" max="65535" />
        </UiField>
        <UiButton variant="secondary" type="button" @click="addForward">{{ t('common.addRule') }}</UiButton>
        <FormActions :loading="saving" @apply="save" />
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.draft {
  margin-top: 4px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}
</style>
