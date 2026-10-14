<script setup lang="ts">
/** A pill with a status dot; the dot pulses for live activity. */
defineProps<{ tone: Tone; label: string }>();
</script>

<template>
  <UBadge :color="tone" variant="outline" size="sm" class="rounded-full font-mono uppercase">
    <span
      class="size-1.5 rounded-full bg-current"
      :class="{ 'animate-pulse': tone === 'info' }"
      aria-hidden="true"
    />
    {{ label }}
  </UBadge>
</template>
