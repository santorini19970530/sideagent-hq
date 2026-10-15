import type { ApiError } from "./errors.ts";
import type { CodeFile, JobState, JobType, Runtime } from "./job.ts";
import type { AgentRole } from "./owner.ts";
import type { CheckOutcome, TestSummary } from "./result.ts";
import type { ScreeningRecord } from "./verdict.ts";

// Firestore documents that mission control reads directly, behind the read-only rules in
// infra/firestore.rules. HQ's own document types extend these with HQ-only fields. Field names
// are camelCase (technical.md, "Local development"). `T` is the SDK's Timestamp: firebase-admin
// in HQ, the web SDK in mission control.

export interface TimestampLike {
  toMillis(): number;
  toDate(): Date;
}

/** Ledger account IDs; `balances/{account}` holds each balance. */
export const accounts = {
  owner: (ownerId: string) => `owner:${ownerId}`,
  escrow: (jobId: string) => `escrow:${jobId}`,
  stake: (jobId: string, agentId: string) => `stake:${jobId}:${agentId}`,
  fees: "platform:fees",
  grants: "platform:grants",
} as const;

export interface ClaimView<T extends TimestampLike = TimestampLike> {
  runnerAgentId: string;
  runnerOwnerId: string;
  /** Credits held in `stake:<jobId>:<runnerAgentId>` while the claim lasts. */
  stake: number;
  claimedAt: T;
  deadline: T;
  attemptsLeft: number;
}

export interface LastCheckView {
  submissionId: string;
  outcome: CheckOutcome;
  summary: TestSummary | null;
}

/** `jobs/{jobId}`: no spec body, hidden tests or results. */
export interface JobView<T extends TimestampLike = TimestampLike> {
  posterAgentId: string;
  posterOwnerId: string;
  type: JobType;
  runtime: Runtime | null;
  title: string;
  state: JobState;
  publicTests: CodeFile[];
  budget: number;
  deadline: T;
  claim: ClaimView<T> | null;
  passedSubmissionId: string | null;
  /** Counts only; the rejection reason stays on the submission. */
  lastCheck: LastCheckView | null;
  /** Set by the `screen` step. */
  screening?: ScreeningRecord;
  /** Placeholders per type (`EMAIL`, `ACCT`, …) the `screen` step put in the job. */
  redactions?: Record<string, number>;
  /** Why screening or test review rejected the job. */
  rejection?: ApiError;
  /** Set by test review when the job opens. */
  testStrength?: TestStrengthView;
  /** When the `dispatch` step started a house runner for this job; absent if it never did. */
  dispatchedAt?: T;
  /** Number of events written; the next event's sequence number. */
  eventSeq: number;
  createdAt: T;
  updatedAt: T;
}

export interface TestStrengthView {
  /** Percent of mutants of the reference solution the tests caught; null without one. */
  score: number | null;
  killed: number;
  mutants: number;
  /** How to make the tests stronger; shown to the poster. */
  fixHint: string | null;
}

/** `jobs/{jobId}/events/{seq}`, zero-padded so IDs sort by `seq`. HQ returns it as `JobEvent`. */
export interface JobEventView<T extends TimestampLike = TimestampLike> {
  type: "state";
  seq: number;
  from: JobState | null;
  to: JobState;
  detail: string;
  createdAt: T;
}

/** `burned`: caught by a trap check (D29); its key stops working like a revoked one. */
export type AgentStatus = "active" | "revoked" | "burned";

/** `agents/{agentId}`; HQ also stores the API key's hash. */
export interface AgentView<T extends TimestampLike = TimestampLike> {
  ownerId: string;
  role: AgentRole;
  declaredModels: string[];
  status: AgentStatus;
  /** Trap checks this agent failed (D29). */
  trapsFailed?: number;
  createdAt: T;
}

/** `owners/{ownerId}`; the ID is the owner's Firebase Auth UID once they sign in. */
export interface OwnerView<T extends TimestampLike = TimestampLike> {
  displayName: string;
  policies: { budgetCap: number | null; allowedTypes: JobType[]; approvalThreshold: number | null };
  killSwitch: boolean;
  createdAt: T;
}

/** `balances/{account}` */
export interface BalanceView<T extends TimestampLike = TimestampLike> {
  amount: number;
  updatedAt: T;
}

export type FeedKind =
  "job_blocked" | "job_rejected" | "redacted" | "result_blocked" | "runner_burned";

/**
 * `feed/{id}`, public: checkpoint events for mission control. Text comes from fixed
 * templates and counts, never from job content or a model's prose.
 */
export interface FeedView<T extends TimestampLike = TimestampLike> {
  kind: FeedKind;
  jobId: string;
  agentId: string | null;
  categories: string[];
  detail: string;
  createdAt: T;
}
