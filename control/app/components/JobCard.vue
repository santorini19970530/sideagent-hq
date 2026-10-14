<script setup lang="ts">
defineProps<{ job: Job; selected: boolean }>();
</script>

<template>
  <div class="card" :class="{ selected }">
    <span class="mono muted">#{{ codename(job.id) }}</span>
    <strong>{{ job.title }}</strong>
    <div class="row">
      <span class="badge" :class="`tone-${toneOf(job.state)}`">
        {{ STATE_LABELS[job.state] }}
      </span>
      <span class="mono">{{ job.budget }} cr</span>
    </div>
  </div>
</template>

<style scoped>
.card {
  width: 220px;
  display: grid;
  gap: 6px;
  padding: 12px;
  background: var(--panel-raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
}

.card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

strong {
  font-size: 14px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-size: 12px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
