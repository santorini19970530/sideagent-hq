import type { PrefixBlobStore } from "../adapters/blob/gcs.ts";
import type { Execution, JobsClient, OperationPolling } from "../adapters/cloud-run-jobs.ts";
import {
  CHECK_OUTPUT_FILES,
  checkBundleFiles,
  inferCheckOutcome,
  pythonCheckArgs,
  type CheckOutputs,
} from "../runtimes/python.ts";
import type { Sandbox } from "./types.ts";

// Where the sandbox job mounts the input (read-only) and output buckets.
const IN_MOUNT = "/mnt/in";
const OUT_MOUNT = "/mnt/out";
// Margin over the execution's own timeout before HQ stops waiting and retries the step.
const WAIT_MARGIN_SECONDS = 120;
// gax's default backoff grows to a minute between polls, so HQ would notice a 60 s check up to
// ~20 s late, billed and on the demo's critical path three times per job. Polls are free.
const POLLING: OperationPolling = {
  initialRetryDelayMillis: 1000,
  retryDelayMultiplier: 1.5,
  maxRetryDelayMillis: 5000,
  initialRpcTimeoutMillis: null,
  rpcTimeoutMultiplier: null,
  maxRpcTimeoutMillis: null,
  totalTimeoutMillis: null,
};

export interface CloudRunJobSandboxOptions {
  jobs: JobsClient;
  /** Full name of the sandbox job (`projects/…/jobs/sideagent-sandbox-python`). */
  jobName: string;
  /** SANDBOX_IN_BUCKET and SANDBOX_OUT_BUCKET. */
  input: PrefixBlobStore;
  output: PrefixBlobStore;
  timeoutSeconds: number;
}

/** Every folder above `path`'s file, deepest last: `a/b/c.py` → `a`, `a/b`. */
function parentDirs(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * `SANDBOX_MODE=cloud-run-job`: one execution of the sandbox job per check. The bundle goes to
 * `<jobId>/<checkId>/` in the input bucket, the job writes to the same folder in the output
 * bucket, and the outcome is read from the files there, since the exit code isn't visible.
 */
export function createCloudRunJobSandbox({
  jobs,
  jobName,
  input,
  output,
  timeoutSeconds,
}: CloudRunJobSandboxOptions): Sandbox {
  return {
    async runChecks(bundle) {
      if (bundle.runtime !== "python") throw new Error(`No sandbox for runtime ${bundle.runtime}`);
      const prefix = `${bundle.jobId}/${bundle.checkId}`;
      const files = checkBundleFiles(bundle);
      // A retried check reuses its folder; clear what an earlier attempt left.
      await Promise.all([input.deletePrefix(prefix), output.deletePrefix(prefix)]);
      // Folder markers, so the mounts list the folders whether or not they infer them.
      const dirs = new Set(parentDirs(`${prefix}/result/x`));
      for (const f of files) for (const d of parentDirs(`${prefix}/${f.path}`)) dirs.add(d);
      await Promise.all([
        ...[...dirs].map((d) => input.putDir(d)),
        ...parentDirs(`${prefix}/x`).map((d) => output.putDir(d)),
        ...files.map((f) => input.put(`${prefix}/${f.path}`, f.content)),
      ]);

      try {
        const [operation] = await jobs.runJob(
          {
            name: jobName,
            overrides: {
              containerOverrides: [
                { args: pythonCheckArgs(`${IN_MOUNT}/${prefix}`, `${OUT_MOUNT}/${prefix}`) },
              ],
              timeout: { seconds: timeoutSeconds },
            },
          },
          { longrunning: POLLING },
        );
        // A rejected result exits 2, which fails the execution, so a failed run may still have
        // outputs to read.
        const run = await withTimeout(
          operation.promise(),
          (timeoutSeconds + WAIT_MARGIN_SECONDS) * 1000,
        ).then(
          ([execution]) => ({ succeeded: executionSucceeded(execution), error: null }),
          (err: unknown) => ({ succeeded: false, error: err }),
        );
        const outputs = await readOutputs(output, prefix);
        if (!run.succeeded && outputs.error === null) {
          const why = run.error ? String(run.error) : "the execution did not succeed";
          throw new Error(`Sandbox execution ${operation.name ?? ""} failed: ${why}`, {
            cause: run.error ?? undefined,
          });
        }
        return inferCheckOutcome(outputs, run.succeeded);
      } finally {
        // The input holds hidden tests; don't keep it past the check. Lifecycle rules catch misses.
        await Promise.all([input.deletePrefix(prefix), output.deletePrefix(prefix)]).catch(
          (err: unknown) => console.warn(`could not clean up sandbox folder ${prefix}`, err),
        );
      }
    },
  };
}

/** One task, run once, that succeeded: nothing failed or was cancelled. */
function executionSucceeded(execution: Execution | null | undefined): boolean {
  return (
    Number(execution?.succeededCount ?? 0) === 1 &&
    !Number(execution?.failedCount ?? 0) &&
    !Number(execution?.cancelledCount ?? 0)
  );
}

async function readOutputs(output: PrefixBlobStore, prefix: string): Promise<CheckOutputs> {
  const read = async (name: string) => {
    const data = await output.get(`${prefix}/${name}`);
    return data ? new TextDecoder().decode(data) : null;
  };
  const [summary, mutants, error] = await Promise.all([
    read(CHECK_OUTPUT_FILES.summary),
    read(CHECK_OUTPUT_FILES.mutants),
    read(CHECK_OUTPUT_FILES.error),
  ]);
  return { summary, mutants, error };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Sandbox run exceeded ${ms / 1000} seconds`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
