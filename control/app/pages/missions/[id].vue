<script setup lang="ts">
import { accounts, type FeedView, type JobView } from "@sideagent/protocol";
import { collection, doc, query, where, type Timestamp } from "firebase/firestore";

const route = useRoute();
const id = computed(() => String(route.params.id));
useHead({ title: () => `Mission ${codename(id.value)}` });

const { db } = useNuxtApp().$firebase;
// Rules let only the poster and the claiming runner read a job (D36). A denied read and a missing
// job look the same, so the page doesn't reveal whether a mission exists.
const jobDoc = useLiveDoc<JobView<Timestamp>>(() => doc(db, "jobs", id.value));
const job = computed<Job | null>(() =>
  jobDoc.data.value ? { ...jobDoc.data.value, id: id.value } : null,
);
// Only once the job is readable; sorted here, so the query needs no composite index.
const feed = useLiveQuery<FeedView<Timestamp>>(() =>
  job.value ? query(collection(db, "feed"), where("jobId", "==", id.value)) : null,
);
const caught = useSorted(feed.data, (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
</script>

<template>
  <div class="grid max-w-5xl gap-4">
    <UPageHeader
      headline="Mission file · live"
      :title="job || !jobDoc.ready.value ? 'The full file' : 'Eyes only'"
    >
      <template #links>
        <UButton to="/" color="neutral" variant="outline" icon="i-lucide-workflow">
          Mission map
        </UButton>
      </template>
    </UPageHeader>

    <UCard v-if="!job && jobDoc.ready.value">
      <p class="text-muted">
        You're not on this mission. Only its handler and the field agent who accepted it can open
        the file.
      </p>
    </UCard>

    <div v-else-if="job" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <JobTimeline :key="job.id" :job="job" />

      <div class="grid content-start gap-4">
        <UCard :ui="{ body: 'grid gap-3' }">
          <p class="eyebrow">Credits</p>
          <dl
            class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 [&_dd]:text-right [&_dd]:font-mono [&_dt]:text-muted"
          >
            <dt>In escrow</dt>
            <dd>
              <span v-if="job.state === 'released'">0 cr</span>
              <BalanceCell v-else :account="accounts.escrow(job.id)" />
            </dd>
            <dt>Stake held</dt>
            <dd>
              <BalanceCell
                v-if="stakeHeld(job)"
                :account="accounts.stake(job.id, job.claim.runnerAgentId)"
              />
              <span v-else class="text-muted">—</span>
            </dd>
          </dl>
        </UCard>

        <UCard :ui="{ body: 'grid gap-3' }">
          <p class="eyebrow">Checkpoint log</p>
          <UAlert v-if="feed.error.value" :description="feed.error.value" />
          <ol v-if="caught.length" class="grid gap-2.5">
            <li v-for="entry in caught" :key="entry.id" class="grid justify-items-start gap-1">
              <FeedBadge :kind="entry.kind" />
              <span>{{ entry.detail }}</span>
              <time class="text-sm text-muted">{{ formatTime(entry.createdAt.toDate()) }}</time>
            </li>
          </ol>
          <p v-else-if="!feed.error.value" class="text-muted">Nothing caught on this mission.</p>
        </UCard>
      </div>
    </div>
  </div>
</template>
