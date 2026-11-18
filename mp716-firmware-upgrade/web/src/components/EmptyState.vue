<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="empty">
    <strong>{{ title }}</strong>
    <p v-if="description">{{ description }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--color-muted);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
}
.empty strong {
  display: block;
  color: var(--color-title);
  margin-bottom: 4px;
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  line-height: var(--lh-tight);
}
.empty p {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-base);
}
</style>
