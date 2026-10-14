<script setup lang="ts">
import { Handle, Position, VueFlow, useVueFlow, type Edge, type Node } from "@vue-flow/core";

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
        animated: toneOf(job.state) === "active",
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
  <div class="map-page">
    <PageHeader eyebrow="Mission map · live" title="Every mission, from briefing to dead drop">
      <template #aside>
        <p class="muted">{{ jobs.length }} {{ jobs.length === 1 ? "mission" : "missions" }}</p>
      </template>
    </PageHeader>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="layout" :class="{ 'with-detail': selected }">
      <div class="panel canvas">
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
            <div class="lane">
              <span class="lane-title">{{ data.lane.title }}</span>
              <span class="muted">{{ data.lane.hint }} · {{ data.count }}</span>
            </div>
          </template>
          <template #node-job="{ data }">
            <Handle type="target" :position="Position.Bottom" :connectable="false" />
            <JobCard :job="data.job" :selected="data.selected" />
          </template>
          <template #node-runner="{ data }">
            <Handle type="source" :position="Position.Top" :connectable="false" />
            <div class="runner">
              <span class="eyebrow">Field agent</span>
              <span class="mono">{{ codename(data.runnerId) }}</span>
            </div>
          </template>
        </VueFlow>
        <div v-if="!jobs.length" class="empty">
          <p class="eyebrow">No missions yet</p>
          <p class="muted">
            Issue a handler key under <NuxtLink to="/agents">Field agents</NuxtLink>, connect your
            agent to HQ over MCP, and ask it to post a job. It appears here as soon as it is filed.
          </p>
        </div>
      </div>
      <JobTimeline v-if="selected" :key="selected.id" :job="selected" />
    </div>
  </div>
</template>

<style scoped>
.map-page {
  display: grid;
  gap: 16px;
}

.map-page > p {
  margin: 0;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.layout.with-detail {
  grid-template-columns: minmax(0, 1fr) 340px;
}

.canvas {
  height: calc(100vh - 190px);
  min-height: 460px;
  position: relative;
  overflow: hidden;
}

.lane {
  width: 220px;
  display: grid;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}

.lane-title {
  font: 600 12px/1.2 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.runner {
  display: grid;
  gap: 4px;
  padding: 8px 12px;
  border: 1px dashed var(--accent);
  border-radius: var(--radius);
  background: var(--bg);
}

.empty {
  position: absolute;
  inset: auto 24px 24px;
  max-width: 460px;
}

.empty p {
  margin: 0 0 6px;
}

@media (max-width: 960px) {
  .layout.with-detail {
    grid-template-columns: 1fr;
  }
  .canvas {
    height: 60vh;
  }
}
</style>
