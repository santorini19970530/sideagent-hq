<script setup lang="ts">
import type { FeedKind, FeedView } from "@sideagent/protocol";
import { collection, limit, orderBy, query, type Timestamp } from "firebase/firestore";

useHead({ title: "Counterintelligence" });

const { db } = useNuxtApp().$firebase;
// Public and sanitized by HQ: fixed text and counts, never job content (`FeedView`).
const { data: entries, error } = useLiveQuery<FeedView<Timestamp>>(() =>
  query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(50)),
);

const KINDS: Record<FeedKind, { label: string; tone: Tone }> = {
  job_blocked: { label: "Briefing blocked", tone: "error" },
  job_rejected: { label: "Briefing rejected", tone: "error" },
  redacted: { label: "Eyes only", tone: "info" },
  result_blocked: { label: "Debrief held", tone: "error" },
  runner_burned: { label: "Burned", tone: "error" },
};
</script>

<template>
  <div class="grid max-w-5xl gap-4">
    <UPageHeader
      headline="Counterintelligence · live"
      title="Station log"
      description="Every briefing is screened before a field agent sees it, private data is swapped for placeholders, and every debrief faces hidden tests and stings. What counterintelligence caught, as it happens."
    />

    <UAlert v-if="error" :description="error" />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <ol class="divide-y divide-default">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="flex flex-wrap items-baseline gap-2.5 px-4 py-2.5"
        >
          <StateBadge :tone="KINDS[entry.kind].tone" :label="KINDS[entry.kind].label" />
          <span class="min-w-48 flex-1">{{ entry.detail }}</span>
          <span class="font-mono text-sm text-muted">#{{ codename(entry.jobId) }}</span>
          <span v-if="entry.agentId" class="font-mono text-sm text-muted">
            agent {{ codename(entry.agentId) }}
          </span>
          <time class="text-sm text-muted">{{ formatTime(entry.createdAt.toDate()) }}</time>
        </li>
        <li v-if="!entries.length" class="px-4 py-2.5 text-muted">
          All quiet. Nothing caught yet.
        </li>
      </ol>
    </UCard>
  </div>
</template>
