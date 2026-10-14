<script setup lang="ts">
defineProps<{ eyebrow: string; title: string }>();
</script>

<template>
  <div class="page-header">
    <div>
      <p class="eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="$slots.default" class="muted"><slot /></p>
    </div>
    <slot name="aside" />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 16px;
}

h1 {
  margin: 4px 0 6px;
  font-size: 22px;
}

p {
  margin: 0;
}
</style>
