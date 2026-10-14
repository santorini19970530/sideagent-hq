<script setup lang="ts">
/** A yes/no question, opened with `useOverlay()`; closes with `true` only on confirm. */
defineProps<{ title: string; description: string; confirmLabel: string }>();
const emit = defineEmits<{ close: [confirmed: boolean] }>();
</script>

<template>
  <UModal :title="title" :description="description" :close="false">
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="emit('close', false)">Cancel</UButton>
        <UButton color="error" @click="emit('close', true)">{{ confirmLabel }}</UButton>
      </div>
    </template>
  </UModal>
</template>
