<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import UiCard from '@/components/UiCard.vue'
import UiButton from '@/components/UiButton.vue'

const { t } = useI18n()
const router = useRouter()

const entries = computed(() => [
  {
    title: t('devices.wifiAclTitle'),
    desc: t('devices.wifiAclDesc'),
    to: '/wifi/mac',
  },
])
</script>

<template>
  <div>
    <p class="page-desc">{{ t('devices.pageDesc') }}</p>
    <div class="grid">
      <UiCard v-for="item in entries" :key="item.to" :title="item.title">
        <p class="desc">{{ item.desc }}</p>
        <UiButton @click="router.push(item.to)">{{ t('devices.goConfigure') }}</UiButton>
      </UiCard>
    </div>
  </div>
</template>

<style scoped>
.page-desc {
  margin: 0 0 12px;
  color: var(--color-muted);
  font-size: var(--fs-sm);
}
.grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
.desc {
  margin: 0 0 16px;
  color: var(--color-muted);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
</style>
