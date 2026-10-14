import { setTimeout as sleep } from "node:timers/promises";
import type {
  ClaimJobOutput,
  JobStatus,
  JobType,
  LastCheck,
  SubmitResultOutput,
} from "@sideagent/protocol";
import type { Executor } from "./executor/types.ts";
import { HqApiError, type HqClient } from "./hq-client.ts";
import { createWorkspace } from "./workspace.ts";

const WAIT_SECONDS = 30;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const CHECK_POLL_MS = 2_000;

export interface RunnerDeps {
  hq: HqClient;
  executor: Executor;
  log?: (message: string) => void;
}

/** Claims one job and retries under the claim after a failed check (D23). Returns its last status. */
export async function runJob(
  deps: RunnerDeps,
  jobId: string,
  signal?: AbortSignal,
  { pollMs = CHECK_POLL_MS }: { pollMs?: number } = {},
): Promise<JobStatus> {
  const { hq, executor, log = console.log } = deps;
  let previousCheck: LastCheck | undefined;
  for (;;) {
    // After a failed check this returns the claim already held, with fewer attempts left.
    const claim = await hq.claimJob(jobId, { sameOwner: executor.sameOwnerOnly });
    log(`Claimed ${jobId} until ${claim.claim_deadline} (${claim.attempts_left} attempts left)`);
    const submitted = await attempt(deps, claim, previousCheck, signal);
    const status = await waitForCheck(hq, jobId, new Date(claim.claim_deadline), pollMs, signal);
    // Only this attempt's check; a stale one would tell the next attempt the wrong score.
    const check =
      status.last_check?.submission_id === submitted.submission_id ? status.last_check : undefined;
    if (check) log(`Check ${describeCheck(check)}`);
    const attemptsLeft = status.claim?.attempts_left ?? 0;
    if (status.state !== "claimed" || status.role !== "runner" || attemptsLeft === 0) {
      log(`Job is ${status.state}`);
      return status;
    }
    previousCheck = check;
    log(`Trying again; ${attemptsLeft} attempts left`);
  }
}

async function attempt(
  { hq, executor, log = console.log }: RunnerDeps,
  claim: ClaimJobOutput,
  previousCheck: LastCheck | undefined,
  signal?: AbortSignal,
): Promise<SubmitResultOutput> {
  const jobId = claim.job.job_id;
  const workspace = await createWorkspace(claim.job);
  try {
    log(`Running the ${executor.name} executor in ${workspace.dir}`);
    await executor.run({
      job: claim.job,
      dir: workspace.dir,
      deadline: new Date(claim.claim_deadline),
      previousCheck,
      signal,
    });
    const result = await workspace.collect();
    if (result.length === 0) throw new Error("The executor wrote no result files");
    log(`Submitting ${result.map((f) => f.path).join(", ")}`);
    // Stable per claim and attempt, so a retried request can't use up a second attempt.
    const key = `${claim.claim_deadline}/${claim.attempts_left}`;
    const submitted = await hq.submitResult(jobId, result, key);
    log(`Submitted ${submitted.submission_id}`);
    return submitted;
  } finally {
    await workspace.dispose();
  }
}

async function waitForCheck(
  hq: HqClient,
  jobId: string,
  deadline: Date,
  pollMs: number,
  signal?: AbortSignal,
): Promise<JobStatus> {
  for (;;) {
    const status = await hq.getStatus(jobId, signal);
    if (status.state !== "submitted" && status.state !== "checking") return status;
    // The claim has ended; HQ finishes the check without this runner.
    if (Date.now() >= deadline.getTime()) return status;
    await sleep(pollMs, undefined, { signal });
  }
}

function describeCheck({ outcome, summary }: LastCheck): string {
  return summary ? `${outcome}: ${summary.passed}/${summary.total} tests` : outcome;
}

/** Long-polls HQ and runs each claimable job until `signal` aborts. */
export async function runLoop(
  deps: RunnerDeps,
  { types, signal }: { types?: JobType[]; signal: AbortSignal },
): Promise<void> {
  const { hq, executor, log = console.log } = deps;
  let backoffMs = MIN_BACKOFF_MS;
  log(`Waiting for jobs${executor.sameOwnerOnly ? " posted by your own owner" : ""}...`);
  while (!signal.aborted) {
    try {
      const job = await hq.nextJob(
        { types, sameOwner: executor.sameOwnerOnly, waitSeconds: WAIT_SECONDS },
        signal,
      );
      if (!job) continue;
      log(`Found ${job.job_id}: ${job.title}`);
      await runJob(deps, job.job_id, signal);
      backoffMs = MIN_BACKOFF_MS;
    } catch (err) {
      if (signal.aborted) break;
      if (err instanceof HqApiError && err.body.code === "conflict") {
        log(`Another runner claimed it first: ${err.body.reason}`);
        continue;
      }
      log(`Error: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(backoffMs, undefined, { signal }).catch(() => {});
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }
}
