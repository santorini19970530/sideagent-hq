<script setup lang="ts">
defineProps<{ job: Job; selected: boolean }>();
</script>

<template>
  <div
    class="grid w-55 cursor-pointer gap-1.5 rounded-lg border bg-elevated p-3"
    :class="selected ? 'border-primary ring-3 ring-primary/20' : 'border-default'"
  >
    <span class="font-mono text-xs text-muted">#{{ codename(job.id) }}</span>
    <strong class="truncate text-sm leading-snug">{{ job.title }}</strong>
    <div class="flex items-center justify-between">
      <StateBadge :tone="toneOf(job.state)" :label="STATE_LABELS[job.state]" />
      <span class="font-mono text-xs">{{ job.budget }} cr</span>
    </div>
  </div>
</template>
