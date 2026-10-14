import type {
  CheckOutcome,
  CodeFile,
  JobState,
  JobSummary,
  JobType,
  Runtime,
  TestSummary,
} from "@sideagent/protocol";
import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HqError } from "../errors.ts";
import { canTransition } from "../jobs/transitions.ts";
import { accounts, transfer } from "../ledger/ledger.ts";

export interface ClaimDoc {
  runnerAgentId: string;
  runnerOwnerId: string;
  /** Credits held in `stake:<jobId>:<runnerAgentId>` while the claim lasts. */
  stake: number;
  claimedAt: Timestamp;
  deadline: Timestamp;
  attemptsLeft: number;
}

/** `jobs/{jobId}`. Read by mission control later, so no spec body, hidden tests or results. */
export interface JobDoc {
  posterAgentId: string;
  posterOwnerId: string;
  type: JobType;
  runtime: Runtime | null;
  title: string;
  state: JobState;
  specRef: string;
  publicTests: CodeFile[];
  budget: number;
  deadline: Timestamp;
  claim: ClaimDoc | null;
  passedSubmissionId: string | null;
  /** When the `dispatch` step started a house runner for this job; absent if it never did. */
  dispatchedAt?: Timestamp;
  /** Counts only; the rejection reason stays on the submission. */
  lastCheck: LastCheckDoc | null;
  idempotencyKey: string;
  requestHash: string;
  /** Number of events written; the next event's sequence number. */
  eventSeq: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LastCheckDoc {
  submissionId: string;
  outcome: CheckOutcome;
  summary: TestSummary | null;
}

/** States in which a runner holds a claim that can time out. */
export const CLAIM_HELD_STATES: readonly JobState[] = ["claimed", "running"];

export function jobRef(db: Firestore, jobId: string): DocumentReference {
  return db.collection("jobs").doc(jobId);
}

/** Appends `jobs/{jobId}/events/{seq}` and moves the in-memory job. The caller writes the job. */
export function transition(
  tx: Transaction,
  ref: DocumentReference,
  job: JobDoc,
  to: JobState,
  detail: string,
  at: Timestamp,
): void {
  if (!canTransition(job.state, to)) {
    throw new HqError(
      "invalid_state",
      `Job cannot move from ${job.state} to ${to}`,
      "Call get_status to see the job's current state",
    );
  }
  appendEvent(tx, ref, job, job.state, to, detail, at);
  job.state = to;
  job.updatedAt = at;
}

export function appendEvent(
  tx: Transaction,
  ref: DocumentReference,
  job: JobDoc,
  from: JobState | null,
  to: JobState,
  detail: string,
  at: Timestamp,
): void {
  const seq = job.eventSeq++;
  tx.create(ref.collection("events").doc(String(seq).padStart(6, "0")), {
    type: "state",
    seq,
    from,
    to,
    detail,
    createdAt: at,
  });
}

export interface JobUpdate {
  tx: Transaction;
  ref: DocumentReference;
  job: JobDoc;
  at: Timestamp;
  move(to: JobState, detail: string): void;
}

/**
 * Reads a job in a transaction, lets `fn` change it, and writes it back if it moved.
 * Every field change goes with a transition, so an unmoved job needs no write.
 * `fn` must do any extra reads before calling `move`, which writes an event.
 */
export async function updateJob<T>(
  db: Firestore,
  jobId: string,
  now: Date,
  fn: (u: JobUpdate) => T | Promise<T>,
): Promise<T> {
  const ref = jobRef(db, jobId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw jobNotFound(jobId);
    const job = snap.data() as JobDoc;
    const startSeq = job.eventSeq;
    const at = Timestamp.fromDate(now);
    const out = await fn({
      tx,
      ref,
      job,
      at,
      move: (to, detail) => transition(tx, ref, job, to, detail, at),
    });
    if (job.eventSeq !== startSeq) tx.set(ref, job);
    return out;
  });
}

export function jobNotFound(jobId: string): HqError {
  return new HqError("not_found", `No job ${jobId}`, "Check the job_id; list_jobs shows open jobs");
}

export function claimExpired(job: JobDoc, at: Timestamp): boolean {
  return (
    CLAIM_HELD_STATES.includes(job.state) &&
    job.claim !== null &&
    job.claim.deadline.toMillis() <= at.toMillis()
  );
}

/**
 * Lazy claim timeout (D21): no timer runs; the next write path returns the job to `open`.
 * `slashPercent` of the stake goes to platform fees and the rest back to the runner's owner.
 * Returns that refund, for callers that read the owner's balance before this write.
 */
export function expireClaimIfDue(
  u: JobUpdate,
  slashPercent: number,
): { ownerId: string; amount: number } | null {
  const claim = u.job.claim;
  if (!claim || !claimExpired(u.job, u.at)) return null;
  const slashed = Math.floor((claim.stake * slashPercent) / 100);
  u.move(
    "open",
    slashed ? `Claim timed out; ${slashed} credits of stake slashed` : "Claim timed out",
  );
  releaseStake(u, claim, slashed, "Claim timed out");
  u.job.claim = null;
  return { ownerId: claim.runnerOwnerId, amount: claim.stake - slashed };
}

/** Empties the claim's stake account: `slashed` credits to fees, the rest to the runner's owner. */
export function releaseStake(u: JobUpdate, claim: ClaimDoc, slashed: number, reason: string) {
  const entry = { from: accounts.stake(u.ref.id, claim.runnerAgentId), jobId: u.ref.id, reason };
  const db = u.ref.firestore;
  transfer(u.tx, db, { ...entry, to: accounts.fees, amount: slashed }, u.at);
  const to = accounts.owner(claim.runnerOwnerId);
  transfer(u.tx, db, { ...entry, to, amount: claim.stake - slashed }, u.at);
}

export function toSummary(jobId: string, job: JobDoc): JobSummary {
  return {
    job_id: jobId,
    type: job.type,
    ...(job.runtime ? { runtime: job.runtime } : {}),
    title: job.title,
    state: job.state,
    budget: job.budget,
    deadline: job.deadline.toDate().toISOString(),
    created_at: job.createdAt.toDate().toISOString(),
  };
}
