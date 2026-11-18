<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'
import LoadingState from '@/components/LoadingState.vue'
import EmptyState from '@/components/EmptyState.vue'
import { formatApiError, getRouterApi, unwrap } from '@/api'
import type { WirelessClient } from '@/api'
import { useToastStore } from '@/stores/toast'

type WifiClientDisplay = WirelessClient & { signalDbm?: number }

const { t } = useI18n()
const toast = useToastStore()
const loading = ref(true)
const clients = ref<WifiClientDisplay[]>([])

async function load() {
  loading.value = true
  try {
    const list = unwrap(await getRouterApi().getWirelessClients())
    clients.value = list.map((c) => ({ ...c, signalDbm: c.rssi }))
  } catch (e) {
    toast.error(formatApiError(e, t))
  } finally {
    loading.value = false
  }
}

function formatConnected(sec: number) {
  if (!sec) return '—'
  const minutes = Math.floor(sec / 60)
  if (minutes < 60) return t('wifiClients.connectedMinutes', { n: minutes })
  return t('wifiClients.connectedHours', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

onMounted(() => void load())
</script>

<template>
  <UiCard :title="t('wifiClients.title')">
    <template #actions>
      <UiButton variant="secondary" @click="load">{{ t('common.refresh') }}</UiButton>
    </template>
    <LoadingState v-if="loading" />
    <EmptyState v-else-if="!clients.length" :title="t('wifiClients.emptyTitle')" />
    <table v-else class="table">
      <thead>
        <tr>
          <th>{{ t('common.hostname') }}</th>
          <th>{{ t('common.ip') }}</th>
          <th>{{ t('common.mac') }}</th>
          <th>SSID</th>
          <th>{{ t('wifiClients.signal') }}</th>
          <th>{{ t('wifiClients.downlink') }}</th>
          <th>{{ t('wifiClients.uplink') }}</th>
          <th>{{ t('wifiClients.connected') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in clients" :key="c.mac">
          <td>{{ c.hostname || '—' }}</td>
          <td>{{ c.ipv4 || '—' }}</td>
          <td class="font-mono text-sm">{{ c.mac }}</td>
          <td>{{ c.ssid || '—' }}</td>
          <td>{{ c.signalDbm ?? '—' }} dBm</td>
          <td>{{ c.rxRateMbps ?? '—' }} Mbps</td>
          <td>{{ c.txRateMbps ?? '—' }} Mbps</td>
          <td>{{ formatConnected(c.connectedSec) }}</td>
        </tr>
      </tbody>
    </table>
  </UiCard>
</template>
