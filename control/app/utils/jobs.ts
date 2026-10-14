import type { JobState } from "@sideagent/protocol";

// UI copy uses spy terms; code keeps plain terms (AGENTS.md, glossary in docs/design.md).

export type LaneKey = "screening" | "open" | "claimed" | "checking" | "released" | "closed";

export interface Lane {
  key: LaneKey;
  title: string;
  hint: string;
  states: readonly JobState[];
}

/** Columns of the mission map, left to right, in lifecycle order. */
export const LANES: readonly Lane[] = [
  {
    key: "screening",
    title: "Counterintelligence",
    hint: "Briefing screened",
    states: ["draft", "screening", "test_review"],
  },
  { key: "open", title: "Open missions", hint: "Waiting for a field agent", states: ["open"] },
  {
    key: "claimed",
    title: "In the field",
    hint: "Field agent at work",
    states: ["claimed", "running"],
  },
  {
    key: "checking",
    title: "Debrief check",
    hint: "Hidden tests running",
    states: ["submitted", "checking", "failed"],
  },
  { key: "released", title: "Dead drop", hint: "Debrief released", states: ["passed", "released"] },
  {
    key: "closed",
    title: "Closed",
    hint: "Rejected, expired or cancelled",
    states: ["rejected", "expired", "cancelled", "disputed"],
  },
];

/** Index into LANES; a state no lane lists falls into "Closed". */
export function laneOf(state: JobState): number {
  const index = LANES.findIndex((lane) => lane.states.includes(state));
  return index === -1 ? LANES.length - 1 : index;
}

/** States in which the runner's stake is still held; the claim stays on the job afterwards. */
export const STAKE_HELD_STATES: readonly JobState[] = [
  "claimed",
  "running",
  "submitted",
  "checking",
];

export const STATE_LABELS: Record<JobState, string> = {
  draft: "Briefing filed",
  screening: "Under screening",
  test_review: "Tests under review",
  open: "Open",
  claimed: "Accepted",
  running: "In progress",
  submitted: "Debrief submitted",
  checking: "Debrief check",
  passed: "Passed",
  failed: "Failed check",
  released: "Released",
  expired: "Expired",
  rejected: "Blocked",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

/** Nuxt UI colour of a badge; `info` marks live activity and pulses. */
export type Tone = "neutral" | "info" | "success" | "error";

export function toneOf(state: JobState): Tone {
  if (state === "passed" || state === "released") return "success";
  if (state === "failed" || state === "rejected" || state === "expired") return "error";
  if (state === "open" || state === "draft") return "neutral";
  return "info";
}

export function formatTime(date: Date, withDate = false): string {
  return withDate ? date.toLocaleString("en-GB") : date.toLocaleTimeString("en-GB");
}

/** Short, stable codename for an ID, e.g. for field agents. */
export function codename(id: string): string {
  return id.slice(-4).toUpperCase();
}
