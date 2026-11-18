<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import UiCard from '@/components/UiCard.vue'

const route = useRoute()
const { t } = useI18n()

const title = computed(() => (typeof route.meta.title === 'string' ? route.meta.title : t('stub.page')))
const readActions = computed(() => (Array.isArray(route.meta.readActions) ? route.meta.readActions : []) as string[])
const writeActions = computed(() =>
  (Array.isArray(route.meta.writeActions) ? route.meta.writeActions : []) as string[],
)
const cgi = computed(() => (typeof route.meta.cgi === 'string' ? route.meta.cgi : 'cgi_huayi.cgi'))
</script>

<template>
  <UiCard :title="title" :subtitle="t('stub.subtitle')">
    <p class="desc">{{ t('stub.desc') }}</p>
    <dl class="meta">
      <div>
        <dt>{{ t('stub.cgi') }}</dt>
        <dd><code>{{ cgi }}</code></dd>
      </div>
      <div v-if="readActions.length">
        <dt>{{ t('stub.readActions') }}</dt>
        <dd>
          <code v-for="a in readActions" :key="a" class="chip">{{ a }}</code>
        </dd>
      </div>
      <div v-if="writeActions.length">
        <dt>{{ t('stub.writeActions') }}</dt>
        <dd>
          <code v-for="a in writeActions" :key="a" class="chip">{{ a }}</code>
        </dd>
      </div>
    </dl>
  </UiCard>
</template>

<style scoped>
.desc {
  margin: 0 0 16px;
  color: var(--color-text);
}
.meta {
  display: grid;
  gap: 12px;
  margin: 0;
}
.meta div {
  display: grid;
  gap: 6px;
}
dt {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-muted);
}
dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip,
code {
  font-family: var(--font-family-mono);
  font-size: 12px;
}
.chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--color-bg-muted);
  color: var(--color-title);
}
</style>
