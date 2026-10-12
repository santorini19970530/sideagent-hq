import type { CodeFile, JobState, JobSummary, JobType, Runtime } from "@sideagent/protocol";
import {
  Timestamp,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { HqError } from "../errors.ts";
import { canTransition } from "../jobs/transitions.ts";

export interface ClaimDoc {
  runnerAgentId: string;
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
  idempotencyKey: string;
  requestHash: string;
  /** Number of events written; the next event's sequence number. */
  eventSeq: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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

/** Lazy claim timeout (D21): no timer runs; the next write path returns the job to `open`. */
export function expireClaimIfDue(u: JobUpdate): void {
  if (!claimExpired(u.job, u.at)) return;
  u.move("open", "Claim timed out");
  u.job.claim = null;
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
