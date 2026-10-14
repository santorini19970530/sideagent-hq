<script setup lang="ts">
import { Handle, Position, VueFlow, useVueFlow, type Edge, type Node } from "@vue-flow/core";

useHead({ title: "Mission map" });

const LANE_WIDTH = 240;
const NODE_HEIGHT = 108;
const TOP = 64;

const { jobs, error } = useJobs();
const selectedId = ref<string | null>(null);
const selected = computed(
  () => jobs.value.find((j) => j.id === selectedId.value) ?? jobs.value[0] ?? null,
);

/** Lane headers, one card per job in its lane, and the runners holding claims below. */
const graph = computed(() => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const perLane = LANES.map(() => 0);
  const runners = new Map<string, number>();

  // Oldest first, so a job keeps its slot while newer ones stack below it.
  for (const job of [...jobs.value].reverse()) {
    const lane = laneOf(job.state);
    const row = perLane[lane]!++;
    nodes.push({
      id: job.id,
      type: "job",
      position: { x: lane * LANE_WIDTH, y: TOP + row * NODE_HEIGHT },
      data: { job, selected: job.id === selected.value?.id },
    });
    const runnerId = job.claim?.runnerAgentId;
    if (runnerId) {
      if (!runners.has(runnerId)) runners.set(runnerId, lane);
      edges.push({
        id: `${runnerId}-${job.id}`,
        source: `runner-${runnerId}`,
        target: job.id,
        animated: toneOf(job.state) === "info",
      });
    }
  }

  LANES.forEach((lane, i) =>
    nodes.push({
      id: `lane-${lane.key}`,
      type: "lane",
      position: { x: i * LANE_WIDTH, y: 0 },
      data: { lane, count: perLane[i] },
      selectable: false,
    }),
  );

  const bottom = TOP + Math.max(1, ...perLane) * NODE_HEIGHT + 40;
  const taken = new Map<number, number>();
  for (const [runnerId, lane] of runners) {
    const offset = taken.get(lane) ?? 0;
    taken.set(lane, offset + 1);
    nodes.push({
      id: `runner-${runnerId}`,
      type: "runner",
      position: { x: lane * LANE_WIDTH + offset * 30, y: bottom + offset * 64 },
      data: { runnerId },
      selectable: false,
    });
  }
  return { nodes, edges };
});

const { fitView, onNodeClick } = useVueFlow();
onNodeClick(({ node }) => {
  if (node.type === "job") selectedId.value = node.id;
});
watch(
  () => graph.value.nodes.length,
  () => nextTick(() => fitView({ padding: 0.15, maxZoom: 1 })),
);
</script>

<template>
  <div class="grid gap-4">
    <UPageHeader headline="Mission map · live" title="Every mission, from briefing to dead drop">
      <template #links>
        <p class="text-muted">{{ jobs.length }} {{ jobs.length === 1 ? "mission" : "missions" }}</p>
      </template>
    </UPageHeader>
    <UAlert v-if="error" :description="error" />

    <div class="grid gap-4" :class="{ 'lg:grid-cols-[minmax(0,1fr)_340px]': selected }">
      <UCard
        class="relative h-[60vh] min-h-115 overflow-hidden lg:h-[calc(100vh-190px)]"
        :ui="{ body: 'h-full p-0 sm:p-0' }"
      >
        <VueFlow
          :nodes="graph.nodes"
          :edges="graph.edges"
          :nodes-draggable="false"
          :nodes-connectable="false"
          :zoom-on-scroll="false"
          :min-zoom="0.3"
          :max-zoom="1.5"
          fit-view-on-init
        >
          <template #node-lane="{ data }">
            <div class="grid w-55 gap-0.5 border-b border-default pb-2 text-xs">
              <span class="font-mono font-semibold tracking-[0.12em] uppercase">
                {{ data.lane.title }}
              </span>
              <span class="text-muted">{{ data.lane.hint }} · {{ data.count }}</span>
            </div>
          </template>
          <template #node-job="{ data }">
            <Handle type="target" :position="Position.Bottom" :connectable="false" />
            <JobCard :job="data.job" :selected="data.selected" />
          </template>
          <template #node-runner="{ data }">
            <Handle type="source" :position="Position.Top" :connectable="false" />
            <div
              class="grid gap-1 rounded-lg border border-dashed border-primary bg-default px-3 py-2"
            >
              <span class="eyebrow">Field agent</span>
              <span class="font-mono">{{ codename(data.runnerId) }}</span>
            </div>
          </template>
        </VueFlow>
        <div v-if="!jobs.length" class="absolute inset-x-6 bottom-6 grid max-w-md gap-1.5">
          <p class="eyebrow">No missions yet</p>
          <p class="text-muted">
            Issue a handler key under
            <ULink to="/agents" class="text-default underline">Field agents</ULink>, connect your
            agent to HQ over MCP, and ask it to post a job. It appears here as soon as it is filed.
          </p>
        </div>
      </UCard>
      <JobTimeline v-if="selected" :key="selected.id" :job="selected" />
    </div>
  </div>
</template>
