<script setup lang="ts">
import { accounts } from "@sideagent/protocol";

const { owner } = useOwner();
const { jobs, error } = useJobs();
const ownerAccount = computed(() => (owner.value ? accounts.owner(owner.value.owner_id) : null));
</script>

<template>
  <div class="ledger">
    <PageHeader eyebrow="Ledger · live" title="Where every credit is">
      HQ keeps a double-entry ledger. A posted mission holds its reward in escrow; a field agent
      puts up a stake when it accepts. A passing debrief pays the reward and returns the stake.
    </PageHeader>

    <section class="panel available">
      <p class="eyebrow">Available</p>
      <p class="big"><BalanceCell v-if="ownerAccount" :account="ownerAccount" /></p>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
    <section class="panel table">
      <table>
        <thead>
          <tr>
            <th>Mission</th>
            <th>Status</th>
            <th class="num">Reward</th>
            <th class="num">In escrow</th>
            <th class="num">Stake held</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id">
            <td>
              <span class="mono muted">#{{ codename(job.id) }}</span>
              {{ job.title }}
            </td>
            <td>
              <span class="badge" :class="`tone-${toneOf(job.state)}`">
                {{ STATE_LABELS[job.state] }}
              </span>
            </td>
            <td class="num">{{ job.budget }} cr</td>
            <!-- A released job is settled: escrow paid out and stake returned. -->
            <td class="num">
              <span v-if="job.state === 'released'" class="mono">0 cr</span>
              <BalanceCell v-else :account="accounts.escrow(job.id)" />
            </td>
            <td class="num">
              <BalanceCell
                v-if="job.claim && STAKE_HELD_STATES.includes(job.state)"
                :account="accounts.stake(job.id, job.claim.runnerAgentId)"
              />
              <span v-else class="muted">—</span>
            </td>
          </tr>
          <tr v-if="!jobs.length">
            <td colspan="5" class="muted">No missions yet.</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.ledger {
  display: grid;
  gap: 16px;
  max-width: 980px;
}

.ledger > p {
  margin: 0;
}

.available {
  padding: 18px 20px;
  display: grid;
  gap: 6px;
}

.available p {
  margin: 0;
}

.big {
  font-size: 32px;
  color: var(--accent);
}

.table {
  overflow-x: auto;
}
</style>
