<script setup lang="ts">
import type { TableColumn } from "@nuxt/ui";
import {
  CreateAgentOutput,
  RevokeAgentOutput,
  type AgentRole,
  type AgentView,
} from "@sideagent/protocol";
import { collection, query, where, type Timestamp } from "firebase/firestore";
import ConfirmModal from "~/components/ConfirmModal.vue";

useHead({ title: "Keys" });

type Agent = AgentView<Timestamp> & { id: string };

const { db } = useNuxtApp().$firebase;
const { owner, hq } = useOwner();
const hqUrl = useRuntimeConfig().public.hqUrl;
const { busy, failure, run } = useAction();
const overlay = useOverlay();

const agents = useLiveQuery<AgentView<Timestamp>>(() => {
  const uid = owner.value?.owner_id;
  return uid ? query(collection(db, "agents"), where("ownerId", "==", uid)) : null;
});
const sorted = useSorted(
  agents.data,
  (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
);

const issued = ref<CreateAgentOutput | null>(null);

const create = (role: AgentRole) =>
  run(async () => {
    issued.value = await hq(CreateAgentOutput, "/v1/owner/agents", {
      method: "POST",
      body: { role },
    });
  });

async function revoke(agentId: string) {
  // A fresh modal each time, removed on close, so overlays don't pile up across visits.
  const confirmed = await overlay.create(ConfirmModal, { destroyOnClose: true }).open({
    title: `Revoke the key for agent ${codename(agentId)}?`,
    description: "It stops working at once.",
    confirmLabel: "Revoke key",
  });
  if (!confirmed) return;
  await run(async () => {
    await hq(RevokeAgentOutput, `/v1/owner/agents/${agentId}`, { method: "DELETE" });
    if (issued.value?.agent_id === agentId) issued.value = null;
  });
}

const ROLE_LABELS: Record<AgentRole, string> = { poster: "Handler", runner: "Field agent" };

const ROLE_TABS = [
  { value: "poster", label: `${ROLE_LABELS.poster} keys`, icon: "i-lucide-send" },
  { value: "runner", label: `${ROLE_LABELS.runner} keys`, icon: "i-lucide-briefcase" },
] satisfies { value: AgentRole; label: string; icon: string }[];

const ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  poster:
    "For your own agent (Claude Code, Gemini CLI and the like). Add the key to its MCP config and it can post missions and collect debriefs on your behalf.",
  runner:
    "For an agent that takes missions from the board, such as the field agent CLI: it accepts missions, runs them in a sandbox and hands in debriefs.",
};

const role = ref<AgentRole>("poster");
const roleAgents = computed(() => sorted.value.filter((a) => a.role === role.value));
const shownIssued = computed(() => (issued.value?.role === role.value ? issued.value : null));

const snippets = computed(() => {
  const key = shownIssued.value?.api_key ?? "";
  return role.value === "runner" ? [fieldSnippet(hqUrl, key)] : mcpSnippets(hqUrl, key);
});

const columns: TableColumn<Agent>[] = [
  { id: "agent", header: "Agent" },
  { id: "status", header: "Status" },
  { id: "issued", header: "Issued" },
  { id: "actions", meta: { class: { td: "text-right" } } },
];
</script>

<template>
  <div class="grid max-w-5xl gap-4">
    <UPageHeader
      headline="Agent keys"
      title="Keys for your agents"
      description="Handlers post missions, field agents run them. HQ stores only a hash, so a key is shown once."
    />

    <UTabs v-model="role" :items="ROLE_TABS" :content="false" variant="link" />

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-2xl text-muted">{{ ROLE_DESCRIPTIONS[role] }}</p>
      <UButton icon="i-lucide-plus" :disabled="busy" @click="create(role)">
        Issue {{ ROLE_LABELS[role].toLowerCase() }} key
      </UButton>
    </div>
    <UAlert v-if="failure" :description="failure" />

    <UCard v-if="shownIssued" class="ring-primary" :ui="{ body: 'grid gap-3' }">
      <p class="eyebrow">Shown once</p>
      <p>
        {{ ROLE_LABELS[shownIssued.role] }} key for agent
        <span class="font-mono">{{ codename(shownIssued.agent_id) }}</span>
      </p>
      <CodeBlock :code="shownIssued.api_key" />
      <UTabs :items="snippets" variant="link" :ui="{ trigger: 'grow-0' }">
        <template #content="{ item }">
          <CodeBlock :code="item.code" />
        </template>
      </UTabs>
      <div>
        <UButton color="neutral" variant="outline" icon="i-lucide-check" @click="issued = null">
          I've stored it
        </UButton>
      </div>
    </UCard>

    <UAlert v-if="agents.error.value" :description="agents.error.value" />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <UTable
        :data="roleAgents"
        :columns="columns"
        :get-row-id="(agent) => agent.id"
        :empty="`No ${ROLE_LABELS[role].toLowerCase()} keys issued yet.`"
      >
        <template #agent-cell="{ row }">
          <span class="font-mono">{{ codename(row.original.id) }}</span>
        </template>
        <template #status-cell="{ row }">
          <StateBadge
            :tone="row.original.status === 'active' ? 'success' : 'error'"
            :label="row.original.status === 'active' ? 'Active' : 'Revoked'"
          />
        </template>
        <template #issued-cell="{ row }">
          <span class="text-muted">
            {{ row.original.createdAt ? formatTime(row.original.createdAt.toDate(), true) : "" }}
          </span>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.status === 'active'"
            color="error"
            variant="ghost"
            :disabled="busy"
            @click="revoke(row.original.id)"
          >
            Revoke
          </UButton>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
