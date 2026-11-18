<script setup lang="ts">
import UiIcon from '@/components/UiIcon.vue'
import type { IconName } from '@/components/icons'

defineProps<{ title?: string; subtitle?: string; icon?: IconName }>()
</script>

<template>
  <section class="card">
    <header v-if="title || subtitle || $slots.actions || $slots.extra" class="head">
      <div class="titles">
        <div v-if="title || $slots.extra || icon" class="title-row">
          <UiIcon v-if="icon" class="title-ico" :name="icon" :size="18" />
          <h3 v-if="title" class="typo-card-title">{{ title }}</h3>
          <slot name="extra" />
        </div>
        <p v-if="subtitle" class="sub" :class="{ 'sub-only': !title }">{{ subtitle }}</p>
      </div>
      <div class="actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding: 16px 16px 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.title-ico {
  color: var(--color-primary);
}
.sub {
  margin: 4px 0 0;
  color: var(--color-muted);
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
}
.sub-only {
  margin: 0;
  font-size: var(--fs-sm);
}
.body {
  padding: 14px 16px 16px;
  font-size: var(--fs-base);
}
.actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
}

@media (max-width: 640px) {
  .head {
    flex-direction: column;
    align-items: stretch;
    padding: 12px 12px 0;
  }
  .actions {
    width: 100%;
    justify-content: stretch;
  }
  .actions :deep(.btn) {
    flex: 1;
    min-width: 0;
  }
  .body {
    padding: 12px;
  }
}

@media (max-width: 640px) {
  .head {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    padding: 12px 12px 0;
  }

  .title-row {
    width: 100%;
  }

  .actions {
    width: 100%;
    justify-content: flex-end;
  }

  .actions:empty {
    display: none;
  }

  .body {
    padding: 12px;
  }

  .card {
    border-radius: var(--radius-sm);
  }
}
</style>
