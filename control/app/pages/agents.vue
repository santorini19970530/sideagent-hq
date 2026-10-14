<script setup lang="ts">
import {
  CreateAgentOutput,
  RevokeAgentOutput,
  type AgentRole,
  type AgentView,
} from "@sideagent/protocol";
import { collection, query, where, type Timestamp } from "firebase/firestore";

const { db } = useNuxtApp().$firebase;
const { owner, hq } = useOwner();
const hqUrl = useRuntimeConfig().public.hqUrl;
const { busy, failure, run } = useAction();

const agents = useLiveQuery<AgentView<Timestamp>>(() => {
  const uid = owner.value?.owner_id;
  return uid ? query(collection(db, "agents"), where("ownerId", "==", uid)) : null;
});
const sorted = computed(() =>
  [...agents.data.value].sort(
    (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
  ),
);

const issued = ref<CreateAgentOutput | null>(null);

const create = (role: AgentRole) =>
  run(async () => {
    issued.value = await hq(CreateAgentOutput, "/v1/owner/agents", {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  });

const revoke = (agentId: string) =>
  run(async () => {
    if (!confirm(`Burn the key for agent ${codename(agentId)}? It stops working at once.`)) return;
    await hq(RevokeAgentOutput, `/v1/owner/agents/${agentId}`, { method: "DELETE" });
    if (issued.value?.agent_id === agentId) issued.value = null;
  });

const ROLE_LABELS: Record<AgentRole, string> = { poster: "Handler", runner: "Field agent" };

const snippets = computed(() => {
  const key = issued.value?.api_key ?? "";
  if (issued.value?.role === "runner") {
    return [
      {
        title: "Laptop field agent (Gemma on Ollama)",
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
    { title: "Gemini CLI (.gemini/settings.json)", code: JSON.stringify(gemini, null, 2) },
    {
      title: "Claude Code",
      code: `claude mcp add --transport http sideagent ${hqUrl}/mcp --header "Authorization: Bearer ${key}"`,
    },
  ];
});
</script>

<template>
  <div class="agents">
    <PageHeader eyebrow="Field agents · clearance" title="Keys for your agents">
      A handler key lets an agent post missions over MCP. A field agent key lets a runner accept and
      complete them. HQ stores only a hash, so a key is shown once.
    </PageHeader>

    <div class="actions">
      <button class="primary" :disabled="busy" @click="create('poster')">Issue handler key</button>
      <button :disabled="busy" @click="create('runner')">Issue field agent key</button>
    </div>
    <p v-if="failure" class="error">{{ failure }}</p>

    <section v-if="issued" class="panel issued">
      <p class="eyebrow">Eyes only · shown once</p>
      <p>
        {{ ROLE_LABELS[issued.role] }} key for agent
        <span class="mono">{{ codename(issued.agent_id) }}</span>
      </p>
      <pre>{{ issued.api_key }}</pre>
      <div v-for="snippet in snippets" :key="snippet.title">
        <p class="muted">{{ snippet.title }}</p>
        <pre>{{ snippet.code }}</pre>
      </div>
      <button @click="issued = null">I've stored it</button>
    </section>

    <section class="panel table">
      <p v-if="agents.error.value" class="error">{{ agents.error.value }}</p>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Role</th>
            <th>Status</th>
            <th>Issued</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="agent in sorted" :key="agent.id">
            <td class="mono">{{ codename(agent.id) }}</td>
            <td>{{ ROLE_LABELS[agent.role] }}</td>
            <td>
              <span class="badge" :class="agent.status === 'active' ? 'tone-good' : 'tone-bad'">
                {{ agent.status === "active" ? "Active" : "Burned" }}
              </span>
            </td>
            <td class="muted">
              {{ agent.createdAt ? formatTime(agent.createdAt.toDate(), true) : "" }}
            </td>
            <td class="num">
              <button
                v-if="agent.status === 'active'"
                class="danger"
                :disabled="busy"
                @click="revoke(agent.id)"
              >
                Revoke
              </button>
            </td>
          </tr>
          <tr v-if="!sorted.length">
            <td colspan="5" class="muted">No keys issued yet.</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.agents {
  display: grid;
  gap: 16px;
  max-width: 980px;
}

.agents > p {
  margin: 0;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.issued {
  padding: 18px 20px;
  display: grid;
  gap: 12px;
  border-color: var(--accent);
}

.issued p {
  margin: 0;
}

.table {
  overflow-x: auto;
}
</style>
