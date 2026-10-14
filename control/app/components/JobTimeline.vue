<script setup lang="ts">
import type { TimelineItem } from "@nuxt/ui";
import type { JobEventView } from "@sideagent/protocol";
import { collection, orderBy, query, type Timestamp } from "firebase/firestore";

const props = defineProps<{ job: Job }>();
const { db } = useNuxtApp().$firebase;
const { owner } = useOwner();

const events = useLiveQuery<JobEventView<Timestamp>>(() =>
  query(collection(db, "jobs", props.job.id, "events"), orderBy("seq")),
);
const log = computed<TimelineItem[]>(() =>
  events.data.value.map((event) => ({
    value: event.id,
    date: formatTime(event.createdAt.toDate()),
    title: event.detail,
  })),
);

const isPoster = computed(() => props.job.posterOwnerId === owner.value?.owner_id);
const check = computed(() => props.job.lastCheck?.summary ?? null);
const stakeHeld = computed(() => props.job.claim && STAKE_HELD_STATES.includes(props.job.state));
const strength = computed(() => props.job.testStrength ?? null);
const redacted = computed(() =>
  Object.entries(props.job.redactions ?? {})
    .map(([type, n]) => `${n} ${type.toLowerCase()}`)
    .join(", "),
);
</script>

<template>
  <UCard
    as="aside"
    class="max-h-[calc(100vh-190px)] overflow-y-auto"
    :ui="{ header: 'grid justify-items-start gap-2', body: 'grid content-start gap-4' }"
  >
    <template #header>
      <p class="eyebrow">
        Mission {{ codename(job.id) }} · you are the {{ isPoster ? "handler" : "field agent" }}
      </p>
      <h2 class="text-lg font-semibold text-highlighted">{{ job.title }}</h2>
      <StateBadge :tone="toneOf(job.state)" :label="STATE_LABELS[job.state]" />
    </template>

    <dl
      class="grid grid-cols-2 gap-3 [&_dd]:mt-0.5 [&_dd]:font-mono [&_dd]:text-sm [&_dt]:text-xs [&_dt]:text-muted"
    >
      <div>
        <dt>Reward</dt>
        <dd>{{ job.budget }} cr</dd>
      </div>
      <div>
        <dt>Field agent</dt>
        <dd>{{ job.claim ? codename(job.claim.runnerAgentId) : "None yet" }}</dd>
      </div>
      <div v-if="stakeHeld">
        <dt>Stake held</dt>
        <dd>{{ job.claim?.stake }} cr</dd>
      </div>
      <div v-if="check">
        <dt>Last debrief</dt>
        <dd>{{ check.passed }}/{{ check.total }} tests</dd>
      </div>
      <div v-if="job.screening">
        <dt>Screening</dt>
        <dd>
          {{ job.screening.verdict === "allow" ? "Cleared" : "Blocked" }}
          {{ job.screening.escalated ? "(escalated)" : "" }}
        </dd>
      </div>
      <div v-if="redacted">
        <dt>Eyes only</dt>
        <dd>{{ redacted }}</dd>
      </div>
      <div v-if="strength?.score != null">
        <dt>Test strength</dt>
        <dd>{{ strength.score }}% · {{ strength.killed }}/{{ strength.mutants }} caught</dd>
      </div>
    </dl>

    <p v-if="strength?.fixHint && isPoster" class="text-muted">{{ strength.fixHint }}</p>

    <UAlert
      v-if="job.rejection && isPoster"
      :title="job.rejection.reason"
      :description="job.rejection.fix_hint"
    />

    <p class="eyebrow">Mission log</p>
    <UAlert v-if="events.error.value" :description="events.error.value" />
    <UTimeline
      :items="log"
      :default-value="log.at(-1)?.value"
      size="3xs"
      :ui="{ date: 'font-mono text-xs', title: 'font-normal' }"
    />
  </UCard>
</template>
