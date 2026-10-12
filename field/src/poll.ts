import { setTimeout as sleep } from "node:timers/promises";
import type { JobType, SubmitResultOutput } from "@sideagent/protocol";
import type { Executor } from "./executor/types.ts";
import { HqApiError, type HqClient } from "./hq-client.ts";
import { createWorkspace } from "./workspace.ts";

const WAIT_SECONDS = 30;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface RunnerDeps {
  hq: HqClient;
  executor: Executor;
  log?: (message: string) => void;
}

/** Claims one job, solves it in a throwaway workspace and submits the result. */
export async function runJob(
  { hq, executor, log = console.log }: RunnerDeps,
  jobId: string,
  signal?: AbortSignal,
): Promise<SubmitResultOutput> {
  const claim = await hq.claimJob(jobId, { sameOwner: executor.sameOwnerOnly });
  log(`Claimed ${jobId} until ${claim.claim_deadline} (${claim.attempts_left} attempts left)`);

  const workspace = await createWorkspace(claim.job);
  try {
    log(`Running the ${executor.name} executor in ${workspace.dir}`);
    await executor.run({
      job: claim.job,
      dir: workspace.dir,
      deadline: new Date(claim.claim_deadline),
      signal,
    });
    const result = await workspace.collect();
    if (result.length === 0) throw new Error("The executor wrote no result files");
    log(`Submitting ${result.map((f) => f.path).join(", ")}`);
    // Stable per claim and attempt, so a retried request can't use up a second attempt.
    const key = `${claim.claim_deadline}/${claim.attempts_left}`;
    const submitted = await hq.submitResult(jobId, result, key);
    log(`Submitted ${submitted.submission_id}; job is ${submitted.state}`);
    return submitted;
  } finally {
    await workspace.dispose();
  }
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
