<script setup lang="ts">
import type { JobEventView } from "@sideagent/protocol";
import { collection, orderBy, query, type Timestamp } from "firebase/firestore";

const props = defineProps<{ job: Job }>();
const { db } = useNuxtApp().$firebase;
const { owner } = useOwner();

const events = useLiveQuery<JobEventView<Timestamp>>(() =>
  query(collection(db, "jobs", props.job.id, "events"), orderBy("seq")),
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
  <aside class="panel detail">
    <header>
      <p class="eyebrow">
        Mission {{ codename(job.id) }} · you are the {{ isPoster ? "handler" : "field agent" }}
      </p>
      <h2>{{ job.title }}</h2>
      <span class="badge" :class="`tone-${toneOf(job.state)}`">
        {{ STATE_LABELS[job.state] }}
      </span>
    </header>

    <dl class="facts">
      <div>
        <dt>Reward</dt>
        <dd class="mono">{{ job.budget }} cr</dd>
      </div>
      <div>
        <dt>Field agent</dt>
        <dd class="mono">{{ job.claim ? codename(job.claim.runnerAgentId) : "None yet" }}</dd>
      </div>
      <div v-if="stakeHeld">
        <dt>Stake held</dt>
        <dd class="mono">{{ job.claim?.stake }} cr</dd>
      </div>
      <div v-if="check">
        <dt>Last debrief</dt>
        <dd class="mono">{{ check.passed }}/{{ check.total }} tests</dd>
      </div>
      <div v-if="job.screening">
        <dt>Screening</dt>
        <dd class="mono">
          {{ job.screening.verdict === "allow" ? "Cleared" : "Blocked" }}
          {{ job.screening.escalated ? "(escalated)" : "" }}
        </dd>
      </div>
      <div v-if="redacted">
        <dt>Eyes only</dt>
        <dd class="mono">{{ redacted }}</dd>
      </div>
      <div v-if="strength?.score != null">
        <dt>Test strength</dt>
        <dd class="mono">
          {{ strength.score }}% · {{ strength.killed }}/{{ strength.mutants }} caught
        </dd>
      </div>
    </dl>

    <p v-if="strength?.fixHint && isPoster" class="muted hint">{{ strength.fixHint }}</p>

    <div v-if="job.rejection && isPoster" class="rejection">
      <p class="error">{{ job.rejection.reason }}</p>
      <p class="muted">{{ job.rejection.fix_hint }}</p>
    </div>

    <p class="eyebrow">Mission log</p>
    <p v-if="events.error.value" class="error">{{ events.error.value }}</p>
    <ol class="log">
      <li v-for="event in events.data.value" :key="event.id">
        <span class="mono muted">{{ formatTime(event.createdAt.toDate()) }}</span>
        <span>{{ event.detail }}</span>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.rejection {
  display: grid;
  gap: 4px;
}

.rejection p,
.hint {
  margin: 0;
}

.detail {
  padding: 20px;
  max-height: calc(100vh - 190px);
  overflow-y: auto;
  display: grid;
  gap: 16px;
  align-content: start;
}

header {
  display: grid;
  gap: 8px;
  justify-items: start;
}

h2 {
  margin: 0;
  font-size: 19px;
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

dt {
  color: var(--muted);
  font-size: 12px;
}

dd {
  margin: 2px 0 0;
}

.log {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
  border-left: 1px solid var(--line);
}

.log li {
  display: grid;
  gap: 2px;
  padding-left: 14px;
  position: relative;
}

.log li::before {
  content: "";
  position: absolute;
  left: -4px;
  top: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--line);
}

.log li:last-child::before {
  background: var(--accent);
}

.log .mono {
  font-size: 12px;
}
</style>
