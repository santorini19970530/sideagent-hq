<script setup lang="ts">
import type { FeedKind, FeedView } from "@sideagent/protocol";
import { collection, limit, orderBy, query, type Timestamp } from "firebase/firestore";

const { db } = useNuxtApp().$firebase;
// Public and sanitized by HQ: fixed text and counts, never job content (`FeedView`).
const { data: entries, error } = useLiveQuery<FeedView<Timestamp>>(() =>
  query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(50)),
);

const KINDS: Record<FeedKind, { label: string; tone: "good" | "bad" | "active" }> = {
  job_blocked: { label: "Briefing blocked", tone: "bad" },
  job_rejected: { label: "Briefing rejected", tone: "bad" },
  redacted: { label: "Eyes only", tone: "active" },
  result_blocked: { label: "Debrief held", tone: "bad" },
  runner_burned: { label: "Burned", tone: "bad" },
};
</script>

<template>
  <div class="feed">
    <PageHeader eyebrow="Counterintelligence · live" title="Station log">
      Every briefing is screened before a field agent sees it, private data is swapped for
      placeholders, and every debrief faces hidden tests and stings. What counterintelligence
      caught, as it happens.
    </PageHeader>

    <p v-if="error" class="error">{{ error }}</p>
    <ol class="panel entries">
      <li v-for="entry in entries" :key="entry.id">
        <span class="badge" :class="`tone-${KINDS[entry.kind].tone}`">
          {{ KINDS[entry.kind].label }}
        </span>
        <span class="detail">{{ entry.detail }}</span>
        <span class="mono muted">#{{ codename(entry.jobId) }}</span>
        <span v-if="entry.agentId" class="mono muted">agent {{ codename(entry.agentId) }}</span>
        <time class="muted">{{ formatTime(entry.createdAt.toDate()) }}</time>
      </li>
      <li v-if="!entries.length" class="muted">All quiet. Nothing caught yet.</li>
    </ol>
  </div>
</template>

<style scoped>
.feed {
  display: grid;
  gap: 16px;
  max-width: 980px;
}

.feed > p {
  margin: 0;
}

.entries {
  list-style: none;
  margin: 0;
  padding: 6px 0;
}

.entries li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
}

.entries li:last-child {
  border-bottom: none;
}

.detail {
  flex: 1;
  min-width: 200px;
}
</style>
