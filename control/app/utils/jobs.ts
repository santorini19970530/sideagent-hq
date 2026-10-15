import type { JobState, JobView } from "@sideagent/protocol";

// UI copy uses spy terms; code keeps plain terms (AGENTS.md, glossary in docs/design.md).

export type LaneKey = "screening" | "open" | "claimed" | "checking" | "released" | "closed";

export interface Lane {
  key: LaneKey;
  title: string;
  hint: string;
  /** Shown in the lane's slot while it holds no missions. */
  empty: string;
  /** A literal name, so the icon bundle scan finds it (nuxt.config.ts). */
  icon: string;
  states: readonly JobState[];
}

/** Columns of the mission map, left to right, in lifecycle order. */
export const LANES: readonly Lane[] = [
  {
    key: "screening",
    title: "Checkpoint",
    hint: "Briefing screened",
    empty: "Briefings are screened here",
    icon: "i-lucide-scan-eye",
    states: ["draft", "screening", "test_review"],
  },
  {
    key: "open",
    title: "Open missions",
    hint: "Waiting for a field agent",
    empty: "Cleared missions wait here",
    icon: "i-lucide-inbox",
    states: ["open"],
  },
  {
    key: "claimed",
    title: "In the field",
    hint: "Field agent at work",
    empty: "Accepted missions move here",
    icon: "i-lucide-footprints",
    states: ["claimed", "running"],
  },
  {
    key: "checking",
    title: "Debrief check",
    hint: "Hidden tests running",
    empty: "Debriefs face hidden tests here",
    icon: "i-lucide-flask-conical",
    states: ["submitted", "checking", "failed"],
  },
  {
    key: "released",
    title: "Dead drop",
    hint: "Debrief released",
    empty: "Passed debriefs land here",
    icon: "i-lucide-package",
    states: ["passed", "released"],
  },
  {
    key: "closed",
    title: "Closed",
    hint: "Rejected, expired or cancelled",
    empty: "Blocked or expired missions end here",
    icon: "i-lucide-archive",
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

/** Whether the job has a claim whose stake is still held. */
export function stakeHeld<J extends Pick<JobView, "claim" | "state">>(
  job: J,
): job is J & { claim: NonNullable<J["claim"]> } {
  return !!job.claim && STAKE_HELD_STATES.includes(job.state);
}

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

export { codename } from "@sideagent/protocol";
