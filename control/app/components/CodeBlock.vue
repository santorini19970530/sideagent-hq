<script setup lang="ts">
/** A preformatted block with a copy button. */
const props = defineProps<{ code: string }>();
const { copy, copied } = useClipboard({ source: () => props.code });
</script>

<template>
  <div class="relative">
    <pre
      class="overflow-x-auto rounded-md border border-default bg-default py-3 pr-12 pl-3.5 font-mono text-[13px] leading-normal"
      >{{ code }}</pre>
    <UButton
      class="absolute top-1.5 right-1.5"
      color="neutral"
      variant="ghost"
      size="sm"
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      :aria-label="copied ? 'Copied' : 'Copy'"
      @click="copy()"
    />
  </div>
</template>
