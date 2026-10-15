<script setup lang="ts">
import type { FeedKind } from "@sideagent/protocol";

defineProps<{ kind: FeedKind }>();

const KINDS: Record<FeedKind, { label: string; tone: Tone }> = {
  job_blocked: { label: "Briefing blocked", tone: "error" },
  job_rejected: { label: "Briefing rejected", tone: "error" },
  redacted: { label: "Eyes only", tone: "info" },
  result_blocked: { label: "Debrief held", tone: "error" },
  runner_burned: { label: "Burned", tone: "error" },
};
</script>

<template>
  <StateBadge :tone="KINDS[kind].tone" :label="KINDS[kind].label" />
</template>
