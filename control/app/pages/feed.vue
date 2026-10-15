<script setup lang="ts">
import type { FeedView } from "@sideagent/protocol";
import { collection, limit, orderBy, query, type Timestamp } from "firebase/firestore";

useHead({ title: "Counterintelligence" });

const { db } = useNuxtApp().$firebase;
// Public and sanitized by HQ: fixed text and counts, never job content (`FeedView`).
const { data: entries, error } = useLiveQuery<FeedView<Timestamp>>(() =>
  query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(50)),
);
// Only missions the viewer is on link to their page; the rest are someone else's (D36).
const { jobs } = useJobs();
const mine = computed(() => new Set(jobs.value.map((job) => job.id)));
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
          <FeedBadge :kind="entry.kind" />
          <span class="min-w-48 flex-1">{{ entry.detail }}</span>
          <ULink
            v-if="mine.has(entry.jobId)"
            :to="`/missions/${entry.jobId}`"
            class="font-mono text-sm text-muted underline hover:text-default"
          >
            #{{ codename(entry.jobId) }}
          </ULink>
          <span v-else class="font-mono text-sm text-muted">#{{ codename(entry.jobId) }}</span>
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
