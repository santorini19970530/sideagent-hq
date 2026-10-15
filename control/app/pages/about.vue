<script setup lang="ts">
useHead({ title: "Briefing" });
</script>

<template>
  <AboutBriefing>
    <template #action>
      <UButton to="/" icon="i-lucide-workflow">Mission map</UButton>
    </template>
  </AboutBriefing>
</template>
