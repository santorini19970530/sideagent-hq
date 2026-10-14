<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import { accounts } from "@sideagent/protocol";

useHead({ title: "Ledger" });

const { owner } = useOwner();
const { jobs, error } = useJobs();
const ownerAccount = computed(() => (owner.value ? accounts.owner(owner.value.owner_id) : null));

const num = { class: { th: "text-right", td: "text-right font-mono" } };
const columns: TableColumn<Job>[] = [
  { id: "mission", header: "Mission" },
  { id: "status", header: "Status" },
  { id: "reward", header: "Reward", meta: num },
  { id: "escrow", header: "In escrow", meta: num },
  { id: "stake", header: "Stake held", meta: num },
];
</script>

<template>
  <div class="grid max-w-5xl gap-4">
    <UPageHeader
      headline="Ledger · live"
      title="Where every credit is"
      description="HQ keeps a double-entry ledger. A posted mission holds its reward in escrow; a field agent puts up a stake when it accepts. A passing debrief pays the reward and returns the stake."
    />

    <UCard>
      <p class="eyebrow">Available</p>
      <p class="mt-1.5 text-3xl text-primary">
        <BalanceCell v-if="ownerAccount" :account="ownerAccount" />
      </p>
    </UCard>

    <UAlert v-if="error" :description="error" />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <!-- Keyed by job, so a new job doesn't shift every row's balance listeners. -->
      <UTable
        :data="jobs"
        :columns="columns"
        :get-row-id="(job) => job.id"
        empty="No missions yet."
      >
        <template #mission-cell="{ row }">
          <span class="font-mono text-muted">#{{ codename(row.original.id) }}</span>
          {{ row.original.title }}
        </template>
        <template #status-cell="{ row }">
          <StateBadge
            :tone="toneOf(row.original.state)"
            :label="STATE_LABELS[row.original.state]"
          />
        </template>
        <template #reward-cell="{ row }">{{ row.original.budget }} cr</template>
        <!-- A released job is settled: escrow paid out and stake returned. -->
        <template #escrow-cell="{ row }">
          <span v-if="row.original.state === 'released'">0 cr</span>
          <BalanceCell v-else :account="accounts.escrow(row.original.id)" />
        </template>
        <template #stake-cell="{ row }">
          <BalanceCell
            v-if="row.original.claim && STAKE_HELD_STATES.includes(row.original.state)"
            :account="accounts.stake(row.original.id, row.original.claim.runnerAgentId)"
          />
          <span v-else class="text-muted">—</span>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
