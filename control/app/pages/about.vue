<script setup lang="ts">
useHead({ title: "About" });
</script>

<template>
  <AboutBriefing>
    <template #action>
      <UButton to="/" icon="i-lucide-workflow">Mission map</UButton>
    </template>
  </AboutBriefing>
</template>
