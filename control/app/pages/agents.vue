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

useHead({ title: "Field agents" });

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
    title: `Burn the key for agent ${codename(agentId)}?`,
    description: "It stops working at once.",
    confirmLabel: "Burn key",
  });
  if (!confirmed) return;
  await run(async () => {
    await hq(RevokeAgentOutput, `/v1/owner/agents/${agentId}`, { method: "DELETE" });
    if (issued.value?.agent_id === agentId) issued.value = null;
  });
}

const ROLE_LABELS: Record<AgentRole, string> = { poster: "Handler", runner: "Field agent" };

const snippets = computed(() => {
  const key = issued.value?.api_key ?? "";
  if (issued.value?.role === "runner") {
    return [
      {
        label: "Laptop field agent (Gemma on Ollama)",
        code: `SIDEAGENT_HQ_URL=${hqUrl} SIDEAGENT_API_KEY=${key} pnpm field`,
      },
    ];
  }
  const gemini = {
    mcpServers: {
      sideagent: { httpUrl: `${hqUrl}/mcp`, headers: { Authorization: `Bearer ${key}` } },
    },
  };
  return [
    { label: "Gemini CLI (.gemini/settings.json)", code: JSON.stringify(gemini, null, 2) },
    {
      label: "Claude Code",
      code: `claude mcp add --transport http sideagent ${hqUrl}/mcp --header "Authorization: Bearer ${key}"`,
    },
  ];
});

const columns: TableColumn<Agent>[] = [
  { id: "agent", header: "Agent" },
  { id: "role", header: "Role" },
  { id: "status", header: "Status" },
  { id: "issued", header: "Issued" },
  { id: "actions", meta: { class: { td: "text-right" } } },
];
</script>

<template>
  <div class="grid max-w-5xl gap-4">
    <UPageHeader
      headline="Field agents · clearance"
      title="Keys for your agents"
      description="A handler key lets an agent post missions over MCP. A field agent key lets a runner accept and complete them. HQ stores only a hash, so a key is shown once."
    />

    <div class="flex flex-wrap gap-2.5">
      <UButton icon="i-lucide-plus" :disabled="busy" @click="create('poster')">
        Issue handler key
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-plus"
        :disabled="busy"
        @click="create('runner')"
      >
        Issue field agent key
      </UButton>
    </div>
    <UAlert v-if="failure" :description="failure" />

    <UCard v-if="issued" class="ring-primary" :ui="{ body: 'grid gap-3' }">
      <p class="eyebrow">Eyes only · shown once</p>
      <p>
        {{ ROLE_LABELS[issued.role] }} key for agent
        <span class="font-mono">{{ codename(issued.agent_id) }}</span>
      </p>
      <CodeBlock :code="issued.api_key" />
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
        :data="sorted"
        :columns="columns"
        :get-row-id="(agent) => agent.id"
        empty="No keys issued yet."
      >
        <template #agent-cell="{ row }">
          <span class="font-mono">{{ codename(row.original.id) }}</span>
        </template>
        <template #role-cell="{ row }">{{ ROLE_LABELS[row.original.role] }}</template>
        <template #status-cell="{ row }">
          <StateBadge
            :tone="row.original.status === 'active' ? 'success' : 'error'"
            :label="row.original.status === 'active' ? 'Active' : 'Burned'"
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
