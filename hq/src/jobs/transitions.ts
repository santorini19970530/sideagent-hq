import type { JobState } from "@sideagent/protocol";

// Mission lifecycle from docs/design.md.
const NEXT: Record<JobState, readonly JobState[]> = {
  // draft → open skips screening and test review until Phases 5–6 add those steps.
  draft: ["screening", "open", "cancelled"],
  screening: ["test_review", "rejected", "cancelled"],
  test_review: ["open", "rejected", "cancelled"],
  open: ["claimed", "expired", "cancelled"],
  claimed: ["running", "submitted", "open"],
  running: ["submitted", "open"],
  submitted: ["checking"],
  checking: ["passed", "failed"],
  passed: ["released", "disputed"],
  // failed → claimed: the runner still has attempts left on its claim (D23).
  failed: ["claimed", "open", "expired", "disputed"],
  // Dispute resolution is not designed yet.
  disputed: [],
  released: [],
  expired: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return NEXT[from].includes(to);
}
