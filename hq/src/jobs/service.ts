import { setTimeout as sleep } from "node:timers/promises";
import type {
  ClaimJobOutput,
  CodeFile,
  JobEvent,
  JobSpec,
  JobState,
  JobStatus,
  JobSummary,
  JobType,
  ListJobsInput,
  ListJobsOutput,
  Submission,
  SubmitResultOutput,
} from "@sideagent/protocol";
import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { getJson, getText, putJson } from "../adapters/blob/helpers.ts";
import type { BlobStore } from "../adapters/blob/types.ts";
import type { PipelineRunner } from "../adapters/pipeline/types.ts";
import type { Config } from "../config.ts";
import { HqError } from "../errors.ts";
import { sha256Hex } from "../hash.ts";
import type { Agent, AgentRole } from "../store/agents.ts";
import {
  appendEvent,
  CLAIM_HELD_STATES,
  claimExpired,
  expireClaimIfDue,
  jobNotFound,
  jobRef,
  toSummary,
  transition,
  updateJob,
  type JobDoc,
} from "../store/jobs.ts";

const BOARD_STATES: readonly JobState[] = ["open", ...CLAIM_HELD_STATES];
const BOARD_LIMIT = 50;
const POLL_INTERVAL_MS = 1000;

export interface JobServiceDeps {
  db: Firestore;
  blobs: BlobStore;
  pipeline: PipelineRunner;
  config: Pick<Config, "CLAIM_TTL_SECONDS" | "CLAIM_ATTEMPTS">;
  now?: () => Date;
}

export type JobService = ReturnType<typeof createJobService>;

/** Business logic behind both REST and MCP. Transport code only parses input and calls these. */
export function createJobService({
  db,
  blobs,
  pipeline,
  config,
  now = () => new Date(),
}: JobServiceDeps) {
  async function postJob(agent: Agent, input: JobSpec): Promise<JobSummary> {
    requireRole(agent, "poster");
    const at = now();
    if (Date.parse(input.deadline) <= at.getTime()) {
      throw new HqError("invalid_request", "deadline is in the past", "Set a future deadline");
    }
    const jobId = deterministicId("job", agent.id, input.idempotency_key);
    const requestHash = hashJson(input);
    const ref = jobRef(db, jobId);

    const existing = await ref.get();
    if (existing.exists) return replayJob(jobId, existing.data() as JobDoc, requestHash);

    // Blob keys derive from the job ID, so a retry after a partial failure overwrites them.
    const specRef = `jobs/${jobId}/spec.md`;
    const [, hiddenTestsRef, referenceSolutionRef] = await Promise.all([
      blobs.put(specRef, input.spec),
      input.hidden_tests
        ? putJson(blobs, `jobs/${jobId}/hidden_tests.json`, input.hidden_tests)
        : null,
      input.reference_solution
        ? putJson(blobs, `jobs/${jobId}/reference_solution.json`, input.reference_solution)
        : null,
    ]);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return replayJob(jobId, snap.data() as JobDoc, requestHash);
      const ts = Timestamp.fromDate(at);
      const job: JobDoc = {
        posterAgentId: agent.id,
        posterOwnerId: agent.ownerId,
        type: input.type,
        runtime: input.runtime ?? null,
        title: input.title,
        state: "draft",
        specRef,
        publicTests: input.public_tests,
        budget: input.budget,
        deadline: Timestamp.fromDate(new Date(input.deadline)),
        claim: null,
        passedSubmissionId: null,
        idempotencyKey: input.idempotency_key,
        requestHash,
        eventSeq: 0,
        createdAt: ts,
        updatedAt: ts,
      };
      appendEvent(tx, ref, job, null, "draft", "Posted", ts);
      transition(tx, ref, job, "open", "Open for claims", ts);
      tx.create(ref, job);
      tx.create(ref.collection("private").doc("main"), { hiddenTestsRef, referenceSolutionRef });
      return toSummary(jobId, job);
    });
  }

  async function listJobs(input: ListJobsInput): Promise<ListJobsOutput> {
    const at = Timestamp.fromDate(now());
    const snap = await db.collection("jobs").where("state", "in", BOARD_STATES).get();
    const jobs = snap.docs
      .map((doc) => ({ id: doc.id, job: doc.data() as JobDoc }))
      .filter(({ job }) => job.state === "open" || claimExpired(job, at))
      .filter(({ job }) => job.deadline.toMillis() > at.toMillis())
      .filter(({ job }) => !input.types || input.types.includes(job.type))
      .filter(({ job }) => input.min_reward === undefined || job.budget >= input.min_reward)
      .sort((a, b) => a.job.createdAt.toMillis() - b.job.createdAt.toMillis())
      .slice(0, BOARD_LIMIT)
      // An expired claim reads as open; the next claim or status call writes it back.
      .map(({ id, job }) => toSummary(id, { ...job, state: "open" }));
    return { jobs };
  }

  /** Long-poll for runners: the oldest claimable job, or null after `waitMs` or on disconnect. */
  async function nextJob(
    agent: Agent,
    types: JobType[] | undefined,
    waitMs: number,
    signal?: AbortSignal,
  ) {
    requireRole(agent, "runner");
    const until = Date.now() + waitMs;
    for (;;) {
      const [job] = (await listJobs({ types })).jobs;
      if (job || Date.now() >= until || signal?.aborted) return job ?? null;
      await sleep(Math.min(POLL_INTERVAL_MS, until - Date.now()), undefined, { signal }).catch(
        () => {},
      );
    }
  }

  async function claimJob(agent: Agent, jobId: string): Promise<ClaimJobOutput> {
    requireRole(agent, "runner");
    const { job, claim } = await updateJob(db, jobId, now(), (u) => {
      expireClaimIfDue(u);
      // A retried claim by the same runner returns the existing claim.
      const held = u.job.claim;
      if (held?.runnerAgentId === agent.id) return { job: u.job, claim: held };
      if (u.job.state !== "open") {
        throw new HqError(
          "conflict",
          `Job is ${u.job.state}`,
          "Call list_jobs and claim an open job",
        );
      }
      if (u.job.deadline.toMillis() <= u.at.toMillis()) {
        throw new HqError("invalid_state", "Job deadline has passed", "Claim a different job");
      }
      const deadlineMs = Math.min(
        u.at.toMillis() + config.CLAIM_TTL_SECONDS * 1000,
        u.job.deadline.toMillis(),
      );
      const claim = {
        runnerAgentId: agent.id,
        claimedAt: u.at,
        deadline: Timestamp.fromMillis(deadlineMs),
        attemptsLeft: config.CLAIM_ATTEMPTS,
      };
      u.job.claim = claim;
      u.move("claimed", `Claimed by runner ${agent.id}`);
      return { job: u.job, claim };
    });
    return {
      job: {
        ...toSummary(jobId, job),
        spec: await getText(blobs, job.specRef),
        public_tests: job.publicTests,
      },
      claim_deadline: claim.deadline.toDate().toISOString(),
      attempts_left: claim.attemptsLeft,
    };
  }

  async function submitResult(agent: Agent, input: Submission): Promise<SubmitResultOutput> {
    requireRole(agent, "runner");
    const jobId = input.job_id;
    const submissionId = deterministicId("sub", agent.id, jobId, input.idempotency_key);
    const subRef = jobRef(db, jobId).collection("submissions").doc(submissionId);
    const requestHash = hashJson(input);

    // Check for a replay before writing the blob, so a conflicting retry can't overwrite it.
    const existing = await subRef.get();
    if (existing.exists) {
      const job = await jobRef(db, jobId).get();
      return replaySubmission(jobId, submissionId, existing.data()!, requestHash, job.get("state"));
    }

    const resultRef = await putJson(
      blobs,
      `jobs/${jobId}/submissions/${submissionId}.json`,
      input.result,
    );
    const out = await updateJob(db, jobId, now(), async (u) => {
      const snap = await u.tx.get(subRef);
      if (snap.exists) {
        return replaySubmission(jobId, submissionId, snap.data()!, requestHash, u.job.state);
      }
      expireClaimIfDue(u);
      const claim = u.job.claim;
      const fixHint = "Claim the job with claim_job before submitting; get_status shows its state";
      if (claim?.runnerAgentId !== agent.id) {
        throw new HqError("invalid_state", "You do not hold an active claim on this job", fixHint);
      }
      if (!CLAIM_HELD_STATES.includes(u.job.state)) {
        throw new HqError("invalid_state", `Job is ${u.job.state}`, fixHint);
      }
      if (claim.attemptsLeft <= 0) {
        throw new HqError("invalid_state", "No submission attempts left", "Claim another job");
      }
      claim.attemptsLeft -= 1;
      u.tx.create(subRef, {
        runnerAgentId: agent.id,
        resultRef,
        testSummary: null,
        idempotencyKey: input.idempotency_key,
        requestHash,
        attemptsLeft: claim.attemptsLeft,
        createdAt: u.at,
      });
      u.move("submitted", `Submission ${submissionId}`);
      return {
        job_id: jobId,
        submission_id: submissionId,
        state: u.job.state,
        attempts_left: claim.attemptsLeft,
      };
    });
    // Steps are idempotent, so re-enqueueing on a replay recovers a check that never ran.
    if (out.state === "submitted") await pipeline.enqueue("check", { jobId, submissionId });
    return out;
  }

  async function getStatus(agent: Agent, jobId: string): Promise<JobStatus> {
    const ref = jobRef(db, jobId);
    const eventsQuery = ref.collection("events").orderBy("seq");
    const [snap, firstEvents] = await Promise.all([ref.get(), eventsQuery.get()]);
    let events = firstEvents;
    if (!snap.exists) throw jobNotFound(jobId);
    let job = snap.data() as JobDoc;
    // Only an expired claim needs a write; plain reads keep polling off the transaction path.
    if (claimExpired(job, Timestamp.fromDate(now()))) {
      job = await updateJob(db, jobId, now(), (u) => {
        expireClaimIfDue(u);
        return u.job;
      });
      events = await eventsQuery.get();
    }
    const role = roleOf(job, agent);
    const status: JobStatus = {
      ...toSummary(jobId, job),
      role,
      events: events.docs.map((doc): JobEvent => ({
        seq: doc.get("seq"),
        from: doc.get("from"),
        to: doc.get("to"),
        detail: doc.get("detail"),
        at: (doc.get("createdAt") as Timestamp).toDate().toISOString(),
      })),
    };
    if (job.claim && role !== "observer") {
      status.claim = {
        deadline: job.claim.deadline.toDate().toISOString(),
        attempts_left: job.claim.attemptsLeft,
      };
    }
    // Posters never see a result before it passes and is released.
    if (role === "poster" && job.state === "released" && job.passedSubmissionId) {
      const sub = await jobRef(db, jobId)
        .collection("submissions")
        .doc(job.passedSubmissionId)
        .get();
      status.result = await getJson<CodeFile[]>(blobs, sub.get("resultRef"));
    }
    return status;
  }

  return { postJob, listJobs, nextJob, claimJob, submitResult, getStatus };
}

function requireRole(agent: Agent, role: AgentRole): void {
  if (agent.role !== role) {
    throw new HqError(
      "forbidden",
      `This call needs a ${role} agent; your key belongs to a ${agent.role}`,
      `Use a ${role} agent's API key`,
    );
  }
}

function roleOf(job: JobDoc, agent: Agent): JobStatus["role"] {
  if (job.posterAgentId === agent.id) return "poster";
  if (job.claim?.runnerAgentId === agent.id) return "runner";
  return "observer";
}

function replaySubmission(
  jobId: string,
  submissionId: string,
  sub: DocumentData,
  requestHash: string,
  state: JobState,
): SubmitResultOutput {
  if (sub.requestHash !== requestHash) throw idempotencyConflict();
  return { job_id: jobId, submission_id: submissionId, state, attempts_left: sub.attemptsLeft };
}

function replayJob(jobId: string, job: JobDoc, requestHash: string): JobSummary {
  if (job.requestHash !== requestHash) throw idempotencyConflict();
  return toSummary(jobId, job);
}

function idempotencyConflict(): HqError {
  return new HqError(
    "conflict",
    "idempotency_key was already used with a different request",
    "Use a new idempotency_key for a new request, or resend the original request unchanged",
  );
}

function deterministicId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256Hex(parts.join("\0")).slice(0, 24)}`;
}

function hashJson(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}
